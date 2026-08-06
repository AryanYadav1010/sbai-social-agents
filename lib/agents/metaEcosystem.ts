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

// Instagram's publish flow is two calls: create a media container (image +
// caption), then publish that container. Doing this as two explicit
// functions rather than one combined call keeps each step's failure mode
// separately diagnosable -- container creation and publish fail for
// different reasons (invalid image URL vs. account/permission issues).
export async function createMediaContainer(
  instagramBusinessAccountId: string,
  accessToken: string,
  opts: { imageUrl: string; caption: string }
): Promise<CreateMediaContainerResult> {
  try {
    const res = await fetch(`${GRAPH_BASE}/${instagramBusinessAccountId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: opts.imageUrl,
        caption: opts.caption,
        access_token: accessToken,
      }),
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

// Combined convenience wrapper for the Orchestrator -- create then publish,
// since v1 always does both immediately on human approval (no scheduling
// yet).
export async function publishInstagramPost(
  instagramBusinessAccountId: string,
  accessToken: string,
  opts: { imageUrl: string; caption: string }
): Promise<PublishResult> {
  const container = await createMediaContainer(instagramBusinessAccountId, accessToken, opts);
  if (!container.ok || !container.containerId) {
    return { ok: false, error: container.error || "Failed to create media container." };
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
