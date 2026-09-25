import type { Task } from "graphile-worker";
import { workerPrisma } from "@/src/worker/queue/db";
import { submitVideoAgentProduction } from "@/lib/agents/videoAgent";
import { logAudit } from "@/lib/audit";

// Submits the customer's own pre-approved media assets to the (separate,
// existing) Video Agent product and records the resulting production id --
// does not block waiting for the render, that's checkVideoStatus's job, so
// this worker never holds one concurrency slot for the full render
// duration.
const generateVideo: Task = async (payload, helpers) => {
  const { postId, runId, topic, accountId } = payload as {
    postId: string;
    runId: string;
    topic: string;
    accountId: string;
  };

  const assets = await workerPrisma.mediaAsset.findMany({ where: { accountId } });
  if (assets.length === 0) {
    await workerPrisma.socialPost.update({ where: { id: postId }, data: { status: "NEEDS_MEDIA" } });
    await workerPrisma.automationRun.update({
      where: { id: runId },
      data: { status: "FAILED", error: "No approved media assets configured for this account.", finishedAt: new Date() },
    });
    return;
  }

  // Use a small rotating subset (up to 5) rather than every asset ever
  // uploaded -- keeps the submission fast and the resulting video focused.
  const chosen = [...assets].sort(() => Math.random() - 0.5).slice(0, 5);

  const result = await submitVideoAgentProduction({
    name: `Autonomous run ${runId}`,
    description: topic,
    assets: chosen.map((a) => ({ url: a.url, kind: a.kind === "video" ? "video" : "image" })),
  });

  if (!result.ok || !result.productionId) {
    await workerPrisma.socialPost.update({ where: { id: postId }, data: { status: "PUBLISH_FAILED" } });
    await workerPrisma.automationRun.update({
      where: { id: runId },
      data: { status: "FAILED", error: result.error || "Video Agent submission failed.", finishedAt: new Date() },
    });
    await logAudit({ action: "automation.video_submit_failed", entity: "SocialPost", entityId: postId, metadata: { error: result.error } });
    throw new Error(result.error || "Video Agent submission failed."); // let graphile-worker's backoff retry a transient submission failure
  }

  await workerPrisma.socialPost.update({
    where: { id: postId },
    data: { videoAgentProductionId: result.productionId },
  });
  await logAudit({ action: "automation.video_submitted", entity: "SocialPost", entityId: postId, metadata: { productionId: result.productionId } });

  // Poll on a delay rather than immediately -- renders take real time, no
  // point burning a job attempt checking a production that was queued a
  // second ago.
  await helpers.addJob(
    "checkVideoStatus",
    { postId, runId, productionId: result.productionId },
    { jobKey: `videoStatus:${postId}`, runAt: new Date(Date.now() + 20_000), maxAttempts: 40 }
  );
};

export default generateVideo;
