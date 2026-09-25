import { makeWorkerUtils, type WorkerUtils } from "graphile-worker";

// Used by Next.js API routes (e.g. the approve route, the "Run now" manual
// trigger) to push a durable job onto the queue without needing the
// worker's own long-lived connection -- this is a short-lived client that
// just does one INSERT, so the app's normal pooled DATABASE_URL is fine
// here (unlike the worker process itself, see src/worker/queue/db.ts).
let utilsPromise: Promise<WorkerUtils> | undefined;

async function getWorkerUtils(): Promise<WorkerUtils> {
  if (!utilsPromise) {
    utilsPromise = makeWorkerUtils({ connectionString: process.env.DATABASE_URL });
  }
  return utilsPromise;
}

export async function enqueuePublishJob(postId: string) {
  const utils = await getWorkerUtils();
  // queueName serializes publish jobs per-post (via jobKey dedup below) --
  // actual cross-account serialization for a given platform account
  // happens inside publishApprovedPost.ts using a queueName keyed on
  // accountId, since that's where the real "must not overlap" constraint
  // (the platform's own rate limits / one-post-at-a-time reality) lives.
  await utils.addJob(
    "publishApprovedPost",
    { postId },
    {
      jobKey: `publish:${postId}`,
      jobKeyMode: "preserve_run_at",
      maxAttempts: 6,
    }
  );
}

export async function enqueueScheduleRunNow(scheduleId: string) {
  const utils = await getWorkerUtils();
  // Deliberately NOT deduped by a stable key -- "Run now" is an explicit
  // one-off human action, not a recurring slot, so each click should
  // enqueue its own run. schedulerTick.ts's own dedup (via AutomationRun's
  // unique idempotencyKey) is what protects the *scheduled* occurrences.
  await utils.addJob(
    "runScheduleNow",
    { scheduleId },
    { maxAttempts: 3 }
  );
}
