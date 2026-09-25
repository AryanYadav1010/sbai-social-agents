import { workerPrisma } from "@/src/worker/queue/db";
import { enqueuePublishJob } from "@/src/worker/queue/enqueue";
import { logAudit } from "@/lib/audit";

// Both gates below must independently allow it, per spec: "must be behind
// BOTH a server-side feature flag defaulting to OFF, and explicit
// per-account opt-in." Neither one alone has any effect -- flipping the
// server flag on does not retroactively auto-publish for accounts that
// still have requireApproval=true (the default), and setting
// requireApproval=false on an account does nothing while the server flag
// is off. This is the ONLY place in the codebase that can move a post
// straight to APPROVED without a human clicking the dashboard's Approve
// button -- called from generateSocialDraft.ts and checkVideoStatus.ts at
// the exact point a post would otherwise become PENDING_APPROVAL.
const SERVER_FLAG = process.env.ENABLE_AUTONOMOUS_PUBLISH === "true";

export async function maybeAutoPublish(postId: string, scheduleId: string): Promise<boolean> {
  if (!SERVER_FLAG) return false;

  const schedule = await workerPrisma.automationSchedule.findUnique({ where: { id: scheduleId } });
  if (!schedule || schedule.requireApproval) return false;

  await workerPrisma.socialPost.update({ where: { id: postId }, data: { status: "APPROVED" } });
  await logAudit({
    action: "social_post.auto_approved",
    entity: "SocialPost",
    entityId: postId,
    metadata: { scheduleId, note: "ENABLE_AUTONOMOUS_PUBLISH is on and this schedule has requireApproval=false -- Compliance already passed, this is the only check standing between a draft and going live." },
  });
  await enqueuePublishJob(postId);
  return true;
}
