// Level 2 Meta Ecosystem Agent's X (Twitter) sibling. Same thin
// hand-rolled fetch client style as metaEcosystem.ts/tiktokEcosystem.ts --
// no SDK, just the exact calls this integration needs.
//
// X's API is split across two hosts/eras that both still matter: tweet
// creation is the modern v2 API (api.twitter.com/2), but media upload is
// still the older v1.1 endpoint (upload.twitter.com/1.1) -- there is no v2
// media upload endpoint. Both accept the same OAuth 2.0 user-context
// Bearer token as long as the app has the right scopes, so no separate
// OAuth 1.0a credential is needed here.

const X_API_BASE = "https://api.twitter.com/2";
const X_UPLOAD_BASE = "https://upload.twitter.com/1.1";
const X_MAX_CHUNK_BYTES = 4 * 1024 * 1024; // API allows up to 5MB/chunk; stay comfortably under

export interface XTokenResult {
  ok: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  error?: string;
}

export async function exchangeXCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
  clientId: string,
  clientSecret: string
): Promise<XTokenResult> {
  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch(`${X_API_BASE}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: clientId,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error_description || data?.error || `X token exchange failed (${res.status}).` };
    }
    return {
      ok: true,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresInSeconds: data.expires_in,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error exchanging X OAuth code." };
  }
}

export async function getXHandle(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${X_API_BASE}/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    return res.ok ? data?.data?.username ?? null : null;
  } catch {
    return null;
  }
}

export interface PublishResult {
  ok: boolean;
  mediaId?: string;
  error?: string;
}

async function uploadMedia(
  accessToken: string,
  mediaUrl: string,
  mediaType: "IMAGE" | "VIDEO"
): Promise<{ ok: boolean; mediaId?: string; error?: string }> {
  const mediaRes = await fetch(mediaUrl);
  if (!mediaRes.ok) {
    return { ok: false, error: `Could not fetch media from ${mediaUrl} (${mediaRes.status}).` };
  }
  const buffer = Buffer.from(await mediaRes.arrayBuffer());
  const contentType = mediaType === "VIDEO" ? "video/mp4" : "image/jpeg";
  const mediaCategory = mediaType === "VIDEO" ? "tweet_video" : "tweet_image";

  // INIT
  const initRes = await fetch(`${X_UPLOAD_BASE}/media/upload.json`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      command: "INIT",
      total_bytes: String(buffer.length),
      media_type: contentType,
      media_category: mediaCategory,
    }),
  });
  const initData = await initRes.json();
  if (!initRes.ok) {
    return { ok: false, error: initData?.errors?.[0]?.message || `X media INIT failed (${initRes.status}).` };
  }
  const mediaId: string = initData.media_id_string;

  // APPEND, chunked
  let segmentIndex = 0;
  for (let offset = 0; offset < buffer.length; offset += X_MAX_CHUNK_BYTES) {
    const chunk = buffer.subarray(offset, offset + X_MAX_CHUNK_BYTES);
    const appendRes = await fetch(`${X_UPLOAD_BASE}/media/upload.json`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        command: "APPEND",
        media_id: mediaId,
        media_data: chunk.toString("base64"),
        segment_index: String(segmentIndex),
      }),
    });
    if (!appendRes.ok) {
      const appendData = await appendRes.json().catch(() => null);
      return { ok: false, error: appendData?.errors?.[0]?.message || `X media APPEND failed (${appendRes.status}).` };
    }
    segmentIndex += 1;
  }

  // FINALIZE
  const finalizeRes = await fetch(`${X_UPLOAD_BASE}/media/upload.json`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ command: "FINALIZE", media_id: mediaId }),
  });
  const finalizeData = await finalizeRes.json();
  if (!finalizeRes.ok) {
    return { ok: false, error: finalizeData?.errors?.[0]?.message || `X media FINALIZE failed (${finalizeRes.status}).` };
  }

  // Images finish synchronously; video/GIF need polling via processing_info.
  let processingInfo = finalizeData.processing_info;
  const deadline = Date.now() + 120_000;
  while (processingInfo && processingInfo.state !== "succeeded" && Date.now() < deadline) {
    if (processingInfo.state === "failed") {
      return { ok: false, error: processingInfo.error?.message || "X reported media processing failed." };
    }
    await new Promise((r) => setTimeout(r, (processingInfo.check_after_secs ?? 3) * 1000));
    const statusRes = await fetch(
      `${X_UPLOAD_BASE}/media/upload.json?command=STATUS&media_id=${encodeURIComponent(mediaId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const statusData = await statusRes.json();
    if (!statusRes.ok) {
      return { ok: false, error: statusData?.errors?.[0]?.message || `X media STATUS check failed (${statusRes.status}).` };
    }
    processingInfo = statusData.processing_info;
  }
  if (processingInfo && processingInfo.state !== "succeeded") {
    return { ok: false, error: "Timed out waiting for X to finish processing the media." };
  }

  return { ok: true, mediaId };
}

export async function publishXPost(
  accessToken: string,
  opts: { mediaUrl: string; caption: string; mediaType: "IMAGE" | "VIDEO" }
): Promise<PublishResult> {
  try {
    const media = await uploadMedia(accessToken, opts.mediaUrl, opts.mediaType);
    if (!media.ok || !media.mediaId) {
      return { ok: false, error: media.error || "X media upload failed." };
    }

    const tweetRes = await fetch(`${X_API_BASE}/tweets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: opts.caption, media: { media_ids: [media.mediaId] } }),
    });
    const tweetData = await tweetRes.json();
    if (!tweetRes.ok) {
      return { ok: false, error: tweetData?.errors?.[0]?.message || tweetData?.detail || `X post failed (${tweetRes.status}).` };
    }

    return { ok: true, mediaId: tweetData.data?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error publishing to X." };
  }
}
