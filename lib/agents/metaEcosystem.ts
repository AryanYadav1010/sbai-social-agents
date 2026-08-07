// Level 2 Meta Ecosystem Agent -- Instagram specialist only for v1 (Facebook
// and WhatsApp specialists are real future siblings, not stubs faked here;
// they simply aren't built yet, per the phase-1 scope). Thin hand-rolled
// fetch client against the Graph API, same pattern as every other
// third-party integration built this session (Dograh, Twilio, Microsoft
// Graph) -- no SDK, just the exact calls this agent actually needs.

const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_API_VERSION}`;

export interface CreateMediaContainerResult {
  ok: boolean;
  containerId?: string;
  error?: string;
}

export interface PublishResult {
  ok: boolean;
  mediaId?: string;
  error?: string;
}

// Instagram's publish flow is two calls: create a media container (image/
// video + caption), then publish that container. Doing this as two explicit
// functions rather than one combined call keeps each step's failure mode
// separately diagnosable -- container creation and publish fail for
// different reasons (invalid media URL vs. account/permission issues).
export async function createMediaContainer(
  instagramBusinessAccountId: string,
  accessToken: string,
  opts: { mediaType: "IMAGE" | "VIDEO"; mediaUrl: string; caption: string }
): Promise<CreateMediaContainerResult> {
  try {
    const body: Record<string, string> =
      opts.mediaType === "VIDEO"
        ? { media_type: "REELS", video_url: opts.mediaUrl, caption: opts.caption, access_token: accessToken }
        : { image_url: opts.mediaUrl, caption: opts.caption, access_token: accessToken };

    const res = await fetch(`${GRAPH_BASE}/${instagramBusinessAccountId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error?.message || `Graph API error ${res.status}` };
    }
    return { ok: true, containerId: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error creating media container." };
  }
}

// Video (REELS) containers process asynchronously on Meta's side -- publish
// must wait for status_code to leave IN_PROGRESS before it can succeed.
// Image containers are also polled here for the same code path, but they
// typically report FINISHED on the very first check.
async function waitForContainerReady(
  containerId: string,
  accessToken: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<{ ok: boolean; error?: string }> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const url = new URL(`${GRAPH_BASE}/${containerId}`);
    url.searchParams.set("fields", "status_code");
    url.searchParams.set("access_token", accessToken);

    const res = await fetch(url.toString());
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error?.message || `Graph API error ${res.status}` };
    }

    if (data.status_code === "FINISHED") return { ok: true };
    if (data.status_code === "ERROR") return { ok: false, error: "Media container processing failed on Meta's side." };

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return { ok: false, error: "Timed out waiting for media container to finish processing." };
}

export async function publishMediaContainer(
  instagramBusinessAccountId: string,
  accessToken: string,
  containerId: string
): Promise<PublishResult> {
  try {
    const res = await fetch(`${GRAPH_BASE}/${instagramBusinessAccountId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: accessToken,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error?.message || `Graph API error ${res.status}` };
    }
    return { ok: true, mediaId: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error publishing media container." };
  }
}

// Combined convenience wrapper for the Orchestrator -- create, wait for
// processing, then publish, since v1 always does this immediately on human
// approval (no scheduling yet).
export async function publishInstagramPost(
  instagramBusinessAccountId: string,
  accessToken: string,
  opts: { mediaType: "IMAGE" | "VIDEO"; mediaUrl: string; caption: string }
): Promise<PublishResult> {
  const container = await createMediaContainer(instagramBusinessAccountId, accessToken, opts);
  if (!container.ok || !container.containerId) {
    return { ok: false, error: container.error || "Failed to create media container." };
  }

  const ready = await waitForContainerReady(container.containerId, accessToken);
  if (!ready.ok) {
    return { ok: false, error: ready.error || "Media container did not finish processing." };
  }

  return publishMediaContainer(instagramBusinessAccountId, accessToken, container.containerId);
}

export interface AccountInsights {
  followerCount?: number;
  mediaCount?: number;
}

// Basic insights for the connected account only -- Graph API gives zero
// competitor-account visibility beyond public viewing, per the blueprint's
// own reality-check for this specialist.
export async function getAccountInsights(
  instagramBusinessAccountId: string,
  accessToken: string
): Promise<AccountInsights | null> {
  try {
    const url = new URL(`${GRAPH_BASE}/${instagramBusinessAccountId}`);
    url.searchParams.set("fields", "followers_count,media_count");
    url.searchParams.set("access_token", accessToken);

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    return { followerCount: data.followers_count, mediaCount: data.media_count };
  } catch {
    return null;
  }
}
