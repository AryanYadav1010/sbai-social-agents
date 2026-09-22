// Level 2 Meta Ecosystem Agent's TikTok sibling. Same thin hand-rolled fetch
// client style as metaEcosystem.ts -- no SDK, just the exact calls this
// integration needs against TikTok's Content Posting API v2 (Direct Post).
//
// Direct Post (video.publish scope) -- true one-tap auto-publish, no human
// action inside the TikTok app needed -- enabled on both the app's Sandbox
// and Production Content Posting API config. Sandbox testing with a
// whitelisted target user doesn't require TikTok's own app-review process
// the way going live for the general public would.
//
// FILE_UPLOAD, not PULL_FROM_URL, as the source: PULL_FROM_URL requires
// verifying domain ownership of the media host in TikTok's developer
// portal first. FILE_UPLOAD needs no domain verification -- we fetch the
// video bytes ourselves and PUT them straight to TikTok.

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

// Unaudited apps can only publish as SELF_ONLY (private, visible only to
// the creator) until TikTok reviews the app for public posting -- querying
// creator_info tells us which privacy levels this specific account/app
// combination is actually allowed to use, so we pick a valid one instead of
// guessing and having the post/init call reject it.
async function pickPrivacyLevel(accessToken: string): Promise<{ ok: boolean; privacyLevel?: string; error?: string }> {
  try {
    const res = await fetch(`${TIKTOK_API_BASE}/post/publish/creator_info/query/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    });
    const data = await res.json();
    if (!res.ok || data?.error?.code !== "ok") {
      return { ok: false, error: data?.error?.message || `Failed to query TikTok creator info (${res.status}).` };
    }
    const options: string[] = data.data?.privacy_level_options || [];
    const privacyLevel = options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : options[0];
    if (!privacyLevel) return { ok: false, error: "TikTok returned no available privacy levels for this account." };
    return { ok: true, privacyLevel };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error querying TikTok creator info." };
  }
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
// path used here.
export async function publishTikTokVideo(
  accessToken: string,
  opts: { mediaUrl: string; caption: string }
): Promise<PublishResult> {
  try {
    const privacy = await pickPrivacyLevel(accessToken);
    if (!privacy.ok || !privacy.privacyLevel) {
      return { ok: false, error: privacy.error || "Could not determine an allowed TikTok privacy level." };
    }

    const videoRes = await fetch(opts.mediaUrl);
    if (!videoRes.ok) {
      return { ok: false, error: `Could not fetch video from ${opts.mediaUrl} (${videoRes.status}).` };
    }
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

    const initRes = await fetch(`${TIKTOK_API_BASE}/post/publish/video/init/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        post_info: {
          title: opts.caption,
          privacy_level: privacy.privacyLevel,
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
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
