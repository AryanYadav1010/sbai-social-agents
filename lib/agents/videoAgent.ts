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

export interface SubmitVideoProductionResult {
  ok: boolean;
  productionId?: string;
  error?: string;
}

// Submits a brand-new production for autonomous runs (spec: "Video Agent
// integration" -- the render itself always happens over there, this just
// drives that same public API a human would drive by hand through the
// Video Agent's own UI: create a project, attach the customer's own
// pre-approved media, describe it, kick off the simple one-shot generate
// flow. Returns immediately with the queued production's id -- the
// worker's checkVideoStatus task polls separately rather than blocking a
// job on the render.
export async function submitVideoAgentProduction(opts: {
  name: string;
  description: string;
  assets: { url: string; kind: "image" | "video" }[];
}): Promise<SubmitVideoProductionResult> {
  if (!VIDEO_AGENT_BASE_URL) {
    return { ok: false, error: "VIDEO_AGENT_BASE_URL is not configured." };
  }
  if (opts.assets.length === 0) {
    return { ok: false, error: "No media assets provided to submit." };
  }

  try {
    const projectRes = await fetch(`${VIDEO_AGENT_BASE_URL}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: opts.name }),
    });
    if (!projectRes.ok) {
      return { ok: false, error: `Video Agent project creation failed (${projectRes.status}).` };
    }
    const project = await projectRes.json();
    const projectId: string = project.id;

    const descRes = await fetch(`${VIDEO_AGENT_BASE_URL}/api/projects/${projectId}/description`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: opts.description }),
    });
    if (!descRes.ok) {
      return { ok: false, error: `Video Agent description update failed (${descRes.status}).` };
    }

    for (const asset of opts.assets) {
      const assetRes = await fetch(asset.url);
      if (!assetRes.ok) {
        return { ok: false, error: `Could not fetch asset ${asset.url} (${assetRes.status}).` };
      }
      const blob = await assetRes.blob();
      const form = new FormData();
      form.append("file", blob, asset.url.split("/").pop() || "asset");
      form.append("kind", asset.kind);
      const uploadRes = await fetch(`${VIDEO_AGENT_BASE_URL}/api/projects/${projectId}/assets`, {
        method: "POST",
        body: form,
      });
      if (!uploadRes.ok) {
        return { ok: false, error: `Video Agent asset upload failed (${uploadRes.status}) for ${asset.url}.` };
      }
    }

    const generateRes = await fetch(`${VIDEO_AGENT_BASE_URL}/api/projects/${projectId}/generate-simple`, {
      method: "POST",
    });
    if (!generateRes.ok) {
      const detail = await generateRes.json().catch(() => null);
      return { ok: false, error: detail?.detail || `Video Agent generation failed to start (${generateRes.status}).` };
    }
    const production = await generateRes.json();
    return { ok: true, productionId: production.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error submitting Video Agent production." };
  }
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
