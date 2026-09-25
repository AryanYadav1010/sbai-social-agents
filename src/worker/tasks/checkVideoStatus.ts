import type { Task } from "graphile-worker";
import { workerPrisma } from "@/src/worker/queue/db";
import { getVideoAgentProduction, resolveVideoAgentMedia } from "@/lib/agents/videoAgent";
import { logAudit } from "@/lib/audit";
import { maybeAutoPublish } from "@/src/worker/queue/autoPublishGate";

const RECHECK_DELAY_MS = 15_000;

// Polls one Video Agent production and either re-schedules itself (still
// rendering), finishes the draft (ready), or fails the run (failed/never
// finished within maxAttempts) -- runs as its own job rather than blocking
// generateVideo's worker slot for the whole render duration.
const checkVideoStatus: Task = async (payload, helpers) => {
  const { postId, runId, productionId } = payload as { postId: string; runId: string; productionId: string };

  const production = await getVideoAgentProduction(productionId);
  if (!production) {
    throw new Error(`Video Agent production ${productionId} not found -- will retry.`);
  }

  if (production.status === "failed") {
    await workerPrisma.socialPost.update({ where: { id: postId }, data: { status: "PUBLISH_FAILED" } });
    await workerPrisma.automationRun.update({
      where: { id: runId },
      data: { status: "FAILED", error: production.error || "Video Agent production failed.", finishedAt: new Date() },
    });
    await logAudit({ action: "automation.video_failed", entity: "SocialPost", entityId: postId, metadata: { productionId, error: production.error } });
    return; // permanent failure, don't let graphile-worker retry this check
  }

  if (production.status !== "ready") {
    // Still rendering -- re-enqueue rather than throwing, so this doesn't
    // count against maxAttempts as a "failure," it's expected to take
    // several checks.
    await helpers.addJob(
      "checkVideoStatus",
      { postId, runId, productionId },
      { jobKey: `videoStatus:${postId}`, jobKeyMode: "replace", runAt: new Date(Date.now() + RECHECK_DELAY_MS), maxAttempts: 40 }
    );
    return;
  }

  const resolved = await resolveVideoAgentMedia(productionId);
  if (!resolved.ok || !resolved.mediaUrl) {
    await workerPrisma.socialPost.update({ where: { id: postId }, data: { status: "PUBLISH_FAILED" } });
    await workerPrisma.automationRun.update({
      where: { id: runId },
      data: { status: "FAILED", error: resolved.error || "Video ready but could not resolve a media URL.", finishedAt: new Date() },
    });
    return;
  }

  const post = await workerPrisma.socialPost.update({
    where: { id: postId },
    data: { mediaUrl: resolved.mediaUrl, status: "PENDING_APPROVAL" },
  });
  const run = await workerPrisma.automationRun.update({
    where: { id: runId },
    data: { status: "PENDING_APPROVAL", finishedAt: new Date() },
  });
  await logAudit({ action: "social_post.drafted", entity: "SocialPost", entityId: postId, metadata: { automationRunId: runId, mediaUrl: post.mediaUrl } });

  await maybeAutoPublish(post.id, run.scheduleId);
};

export default checkVideoStatus;
