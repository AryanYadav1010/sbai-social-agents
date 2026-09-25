// Level 2 Meta Ecosystem Agent's X (Twitter) sibling. Same thin
// hand-rolled fetch client style as metaEcosystem.ts/tiktokEcosystem.ts --
// no SDK, just the exact calls this integration needs.
//
// Everything uses the v2 API with the OAuth 2.0 user-context Bearer token.
// Media upload is the v2 chunked endpoint (/2/media/upload/...), which needs
// the media.write scope -- the legacy v1.1 upload.twitter.com endpoint
// rejects OAuth 2.0 user tokens with an empty body.

const X_API_BASE = "https://api.twitter.com/2";
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

export async function refreshXToken(refreshToken: string, clientId: string, clientSecret: string): Promise<XTokenResult> {
  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch(`${X_API_BASE}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.access_token) {
      return { ok: false, error: data?.error_description || data?.error || `X token refresh failed (${res.status}).` };
    }
    return { ok: true, accessToken: data.access_token, refreshToken: data.refresh_token, expiresInSeconds: data.expires_in };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error refreshing X token." };
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- X response shapes vary per endpoint and error type
type XJson = any;

async function readJson(res: Response): Promise<XJson> {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { detail: text.slice(0, 300) }; }
}

function xError(data: XJson, fallback: string): string {
  return data?.errors?.[0]?.message || data?.errors?.[0]?.detail || data?.detail || data?.title || fallback;
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
  const contentType = mediaType === "VIDEO" ? "video/mp4" : mediaRes.headers.get("content-type") || "image/jpeg";
  const auth = { Authorization: `Bearer ${accessToken}` };

  const initRes = await fetch(`${X_API_BASE}/media/upload/initialize`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: contentType,
      total_bytes: buffer.length,
      media_category: mediaType === "VIDEO" ? "tweet_video" : "tweet_image",
    }),
  });
  const initData = await readJson(initRes);
  const mediaId: string | undefined = initData?.data?.id;
  if (!initRes.ok || !mediaId) {
    return { ok: false, error: xError(initData, `X media initialize failed (${initRes.status}).`) };
  }

  let segmentIndex = 0;
  for (let offset = 0; offset < buffer.length; offset += X_MAX_CHUNK_BYTES) {
    const form = new FormData();
    form.append("segment_index", String(segmentIndex));
    form.append("media", new Blob([new Uint8Array(buffer.subarray(offset, offset + X_MAX_CHUNK_BYTES))]));
    const appendRes = await fetch(`${X_API_BASE}/media/upload/${mediaId}/append`, { method: "POST", headers: auth, body: form });
    if (!appendRes.ok) {
      return { ok: false, error: xError(await readJson(appendRes), `X media append failed (${appendRes.status}).`) };
    }
    segmentIndex += 1;
  }

  const finalizeRes = await fetch(`${X_API_BASE}/media/upload/${mediaId}/finalize`, { method: "POST", headers: auth });
  const finalizeData = await readJson(finalizeRes);
  if (!finalizeRes.ok) {
    return { ok: false, error: xError(finalizeData, `X media finalize failed (${finalizeRes.status}).`) };
  }

  // Images are ready immediately; video needs polling until processed.
  let processingInfo = finalizeData?.data?.processing_info;
  const deadline = Date.now() + 120_000;
  while (processingInfo && processingInfo.state !== "succeeded" && Date.now() < deadline) {
    if (processingInfo.state === "failed") {
      return { ok: false, error: processingInfo.error?.message || "X reported media processing failed." };
    }
    await new Promise((r) => setTimeout(r, (processingInfo.check_after_secs ?? 3) * 1000));
    const statusRes = await fetch(`${X_API_BASE}/media/upload?command=STATUS&media_id=${encodeURIComponent(mediaId)}`, { headers: auth });
    const statusData = await readJson(statusRes);
    if (!statusRes.ok) {
      return { ok: false, error: xError(statusData, `X media status check failed (${statusRes.status}).`) };
    }
    processingInfo = statusData?.data?.processing_info;
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
    const tweetData = await readJson(tweetRes);
    if (!tweetRes.ok) {
      return { ok: false, error: xError(tweetData, `X post failed (${tweetRes.status}).`) };
    }

    return { ok: true, mediaId: tweetData.data?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error publishing to X." };
  }
}
