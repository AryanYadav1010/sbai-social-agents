// Level 2 Meta Ecosystem Agent's TikTok sibling. Same thin hand-rolled fetch
// client style as metaEcosystem.ts -- no SDK, just the exact calls this
// integration needs against TikTok's Content Posting API v2.
//
// Uses the inbox/draft endpoint (video.upload scope), not Direct Post
// (video.publish scope): Direct Post -- true one-tap auto-publish -- only
// activates after TikTok reviews and approves the app (a written
// description + demo video, reviewed by TikTok's own team, not something
// this codebase can grant itself). The inbox endpoint needs no review: the
// agent pushes the video straight into the connected account's TikTok
// inbox as a ready-to-post draft, and a human taps Post inside the TikTok
// app to finish. Swap the endpoint below to `video/init/` and re-add a
// privacy-level lookup (see git history) once Direct Post is approved.
//
// FILE_UPLOAD, not PULL_FROM_URL, as the source either way: PULL_FROM_URL
// requires verifying domain ownership of the media host in TikTok's
// developer portal first. FILE_UPLOAD needs no domain verification -- we
// fetch the video bytes ourselves and PUT them straight to TikTok.

const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";

export interface TikTokTokenResult {
  ok: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  openId?: string;
  error?: string;
}

export async function exchangeTikTokCode(
  code: string,
  redirectUri: string,
  clientKey: string,
  clientSecret: string
): Promise<TikTokTokenResult> {
  try {
    const res = await fetch(`${TIKTOK_API_BASE}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return { ok: false, error: data?.error_description || data?.error || `TikTok token exchange failed (${res.status}).` };
    }
    return {
      ok: true,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresInSeconds: data.expires_in,
      openId: data.open_id,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error exchanging TikTok OAuth code." };
  }
}

export async function getTikTokDisplayName(accessToken: string): Promise<string | null> {
  try {
    const url = new URL(`${TIKTOK_API_BASE}/user/info/`);
    url.searchParams.set("fields", "display_name");
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    return res.ok ? data?.data?.user?.display_name ?? null : null;
  } catch {
    return null;
  }
}

export interface PublishResult {
  ok: boolean;
  mediaId?: string;
  error?: string;
}

async function waitForPublishComplete(
  publishId: string,
  accessToken: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<{ ok: boolean; error?: string }> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(`${TIKTOK_API_BASE}/post/publish/status/fetch/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const data = await res.json();
    if (!res.ok || data?.error?.code !== "ok") {
      return { ok: false, error: data?.error?.message || `TikTok status check failed (${res.status}).` };
    }

    const status = data.data?.status;
    if (status === "PUBLISH_COMPLETE" || status === "SEND_TO_USER_INBOX") return { ok: true };
    if (status === "FAILED") return { ok: false, error: data.data?.fail_reason || "TikTok reported the post failed to process." };

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return { ok: false, error: "Timed out waiting for TikTok to finish processing the post." };
}

// Video-only, per TikTok's Content Posting API -- there is no image-post
// path used here. `caption` isn't sent to TikTok: the inbox/draft endpoint
// carries no post_info (title, privacy, etc.) -- the human sets those
// inside the TikTok app when they tap Post. It's kept in the signature so
// callers don't change if/when Direct Post is later approved and this
// switches to the endpoint that does take post_info.
export async function publishTikTokVideo(
  accessToken: string,
  opts: { mediaUrl: string; caption: string }
): Promise<PublishResult> {
  try {
    const videoRes = await fetch(opts.mediaUrl);
    if (!videoRes.ok) {
      return { ok: false, error: `Could not fetch video from ${opts.mediaUrl} (${videoRes.status}).` };
    }
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

    const initRes = await fetch(`${TIKTOK_API_BASE}/post/publish/inbox/video/init/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        source_info: {
          source: "FILE_UPLOAD",
          video_size: videoBuffer.length,
          chunk_size: videoBuffer.length,
          total_chunk_count: 1,
        },
      }),
    });
    const initData = await initRes.json();
    if (!initRes.ok || initData?.error?.code !== "ok") {
      return { ok: false, error: initData?.error?.message || `TikTok post init failed (${initRes.status}).` };
    }
    const publishId: string = initData.data.publish_id;
    const uploadUrl: string = initData.data.upload_url;

    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Range": `bytes 0-${videoBuffer.length - 1}/${videoBuffer.length}`,
      },
      body: videoBuffer,
    });
    if (!uploadRes.ok) {
      return { ok: false, error: `TikTok video upload failed (${uploadRes.status}).` };
    }

    const done = await waitForPublishComplete(publishId, accessToken);
    if (!done.ok) {
      return { ok: false, error: done.error || "TikTok did not finish processing the post." };
    }

    return { ok: true, mediaId: publishId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error publishing to TikTok." };
  }
}
