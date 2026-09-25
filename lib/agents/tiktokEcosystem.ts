// Level 2 Meta Ecosystem Agent's TikTok sibling. Same thin hand-rolled fetch
// client style as metaEcosystem.ts -- no SDK, just the exact calls this
// integration needs against TikTok's Content Posting API v2.
//
// Tries Direct Post first (true auto-publish, no manual tap), and falls
// back to the inbox/draft endpoint if TikTok rejects it for any reason.
// An earlier attempt at Direct Post alone hit a content-guidelines
// rejection even on a video that had already published fine through the
// inbox endpoint -- TikTok support confirmed apps must disclose whether
// content is AI-generated (`is_aigc`), which the earlier attempt omitted.
// Callers pass the real answer per post (true only for Video Agent
// productions, false for a human's own uploaded/linked footage) -- this is
// a disclosure, not a workaround, so it has to be honest per post. The
// fallback stays in place regardless, since Sandbox's "Direct Post" toggle
// may still not fully bypass guideline enforcement for every case.
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
  refreshExpiresInSeconds?: number;
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
      refreshExpiresInSeconds: data.refresh_expires_in,
      openId: data.open_id,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error exchanging TikTok OAuth code." };
  }
}

export async function refreshTikTokToken(
  refreshToken: string,
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
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error || !data.access_token) {
      return { ok: false, error: data?.error_description || data?.error || `TikTok token refresh failed (${res.status}).` };
    }
    return {
      ok: true,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresInSeconds: data.expires_in,
      refreshExpiresInSeconds: data.refresh_expires_in,
      openId: data.open_id,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error refreshing TikTok token." };
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
  // Set whenever Direct Post was attempted and rejected, even if the
  // inbox fallback then succeeded -- otherwise the real reason Direct
  // Post keeps failing is silently lost the moment the fallback saves
  // the overall publish.
  directPostError?: string;
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
  const timeoutMs = opts.timeoutMs ?? 240_000;
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

async function uploadAndWait(
  initEndpoint: string,
  initBody: Record<string, unknown>,
  videoBuffer: Buffer,
  accessToken: string
): Promise<PublishResult> {
  const initRes = await fetch(`${TIKTOK_API_BASE}${initEndpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(initBody),
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
    body: new Uint8Array(videoBuffer),
  });
  if (!uploadRes.ok) {
    return { ok: false, error: `TikTok video upload failed (${uploadRes.status}).` };
  }

  const done = await waitForPublishComplete(publishId, accessToken);
  if (!done.ok) {
    return { ok: false, error: done.error || "TikTok did not finish processing the post." };
  }
  return { ok: true, mediaId: publishId };
}

// Video-only, per TikTok's Content Posting API -- there is no image-post
// path used here. Tries Direct Post (true auto-publish) first; if TikTok
// rejects it for any reason (still not approved for public posting on this
// app/account combination, a guideline check, etc.), falls back to the
// inbox/draft endpoint -- which needs no review and always works -- rather
// than failing the whole publish outright.
export async function publishTikTokVideo(
  accessToken: string,
  opts: { mediaUrl: string; caption: string; isAigc: boolean }
): Promise<PublishResult> {
  try {
    const videoRes = await fetch(opts.mediaUrl);
    if (!videoRes.ok) {
      return { ok: false, error: `Could not fetch video from ${opts.mediaUrl} (${videoRes.status}).` };
    }
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    const sourceInfo = {
      source: "FILE_UPLOAD",
      video_size: videoBuffer.length,
      chunk_size: videoBuffer.length,
      total_chunk_count: 1,
    };

    let directPostError: string | undefined;

    const privacy = await pickPrivacyLevel(accessToken);
    if (privacy.ok && privacy.privacyLevel) {
      const direct = await uploadAndWait(
        "/post/publish/video/init/",
        {
          post_info: {
            title: opts.caption,
            privacy_level: privacy.privacyLevel,
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
            video_cover_timestamp_ms: 1000,
            is_aigc: opts.isAigc, // honest disclosure -- only true for Video Agent-generated media
          },
          source_info: sourceInfo,
        },
        videoBuffer,
        accessToken
      );
      if (direct.ok) return direct;
      directPostError = direct.error;
    } else {
      directPostError = privacy.error;
    }

    // Direct Post unavailable or rejected -- fall back to the inbox/draft
    // endpoint (needs the video.upload scope; video.publish alone won't
    // authorize this call, which is fine, it just also fails closed).
    const inbox = await uploadAndWait("/post/publish/inbox/video/init/", { source_info: sourceInfo }, videoBuffer, accessToken);
    return { ...inbox, directPostError };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error publishing to TikTok." };
  }
}
