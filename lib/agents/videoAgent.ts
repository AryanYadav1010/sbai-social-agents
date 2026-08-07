// Client for the separate Video Agent product (own repo, own deploy --
// FastAPI + OpenMontage/Remotion, generates short vertical videos from
// uploaded photos/videos + a description). This module is the one
// integration point where the social pipeline pulls in a finished video by
// production ID; the video itself is always generated over there, never
// re-implemented here.

const VIDEO_AGENT_BASE_URL = process.env.VIDEO_AGENT_BASE_URL?.replace(/\/$/, "");

export function isVideoAgentConfigured(): boolean {
  return Boolean(VIDEO_AGENT_BASE_URL);
}

export interface VideoAgentRender {
  aspectRatio: string;
  path: string;
  status: string;
}

export interface VideoAgentProduction {
  id: string;
  status: "queued" | "generating" | "ready" | "failed";
  renders: VideoAgentRender[];
  error?: string | null;
}

export interface ResolvedVideoAgentMedia {
  ok: boolean;
  mediaUrl?: string;
  error?: string;
}

// Fetches a production's status/renders from the Video Agent's own API.
export async function getVideoAgentProduction(productionId: string): Promise<VideoAgentProduction | null> {
  if (!VIDEO_AGENT_BASE_URL) return null;

  const res = await fetch(`${VIDEO_AGENT_BASE_URL}/api/productions/${productionId}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;

  const data = await res.json();
  return {
    id: data.id,
    status: data.status,
    renders: (data.renders || []).map((r: { aspect_ratio: string; path: string; status: string }) => ({
      aspectRatio: r.aspect_ratio,
      path: r.path,
      status: r.status,
    })),
    error: data.error,
  };
}

// Resolves a Video Agent production ID to a publicly-reachable video URL,
// suitable for Instagram's video_url field. Fails closed with a clear
// reason for every non-happy path (not configured, not found, still
// rendering, failed, no finished render) rather than a generic error.
export async function resolveVideoAgentMedia(productionId: string): Promise<ResolvedVideoAgentMedia> {
  if (!VIDEO_AGENT_BASE_URL) {
    return { ok: false, error: "VIDEO_AGENT_BASE_URL is not configured." };
  }

  const production = await getVideoAgentProduction(productionId);
  if (!production) {
    return { ok: false, error: `Video Agent production ${productionId} not found.` };
  }
  if (production.status === "failed") {
    return { ok: false, error: `Video Agent production failed: ${production.error || "unknown error"}` };
  }
  if (production.status !== "ready") {
    return { ok: false, error: `Video Agent production is still ${production.status} -- try again once it's ready.` };
  }

  const render = production.renders.find((r) => r.status === "done" && r.path);
  if (!render) {
    return { ok: false, error: "Video Agent production has no finished render." };
  }

  return { ok: true, mediaUrl: `${VIDEO_AGENT_BASE_URL}/renders/${render.path}` };
}
