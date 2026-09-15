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

export interface MediaInsights {
  raw: Record<string, number>;
  likeCount?: number;
  commentsCount?: number;
  savedCount?: number;
  sharesCount?: number;
  reach?: number;
  totalInteractions?: number;
  unavailableFields: string[];
  fetchedAt: string;
}

// Metric availability per media type, verified against Meta's own docs.
// `impressions` is deliberately excluded -- deprecated for media created
// after July 2, 2024, and every post this project will ever publish is
// after that date. Graph API rejects the ENTIRE request if any one
// requested metric is invalid for that media's product type, so each
// candidate is queried individually below rather than as one combined
// `metric=a,b,c` request.
const MEDIA_INSIGHT_METRICS: Record<"IMAGE" | "VIDEO", string[]> = {
  IMAGE: ["likes", "comments", "saved", "shares", "reach", "total_interactions", "profile_activity", "profile_visits"],
  VIDEO: ["likes", "comments", "saved", "shares", "reach", "total_interactions", "ig_reels_avg_watch_time"],
};

// Analytics Agent's read: per-media insights for one already-published post.
// Read-only, admin-triggered on demand (no cron/queue infra in this
// project) -- never called automatically, never affects publishing.
export async function getMediaInsights(
  mediaId: string,
  accessToken: string,
  mediaType: "IMAGE" | "VIDEO"
): Promise<{ ok: boolean; insights?: MediaInsights; error?: string }> {
  const candidates = MEDIA_INSIGHT_METRICS[mediaType];
  const raw: Record<string, number> = {};
  const unavailableFields: string[] = [];

  const results = await Promise.allSettled(
    candidates.map(async (metric) => {
      const url = new URL(`${GRAPH_BASE}/${mediaId}/insights`);
      url.searchParams.set("metric", metric);
      url.searchParams.set("access_token", accessToken);
      const res = await fetch(url.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(metric);
      const value = data?.data?.[0]?.values?.[0]?.value;
      if (typeof value !== "number") throw new Error(metric);
      return { metric, value };
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      raw[result.value.metric] = result.value.value;
    } else {
      unavailableFields.push(result.reason instanceof Error ? result.reason.message : "unknown");
    }
  }

  if (Object.keys(raw).length === 0) {
    return { ok: false, error: "No insight metrics were available for this media." };
  }

  return {
    ok: true,
    insights: {
      raw,
      likeCount: raw.likes,
      commentsCount: raw.comments,
      savedCount: raw.saved,
      sharesCount: raw.shares,
      reach: raw.reach,
      totalInteractions: raw.total_interactions,
      unavailableFields,
      fetchedAt: new Date().toISOString(),
    },
  };
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
