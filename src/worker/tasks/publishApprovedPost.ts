import type { Task } from "graphile-worker";
import { publishApprovedPost as publish } from "@/lib/orchestrator/publish";

// Thin queue wrapper around the real publish logic (lib/orchestrator/publish.ts)
// -- the same function the dashboard's approve route used to call inline.
// The only thing this wrapper adds is deciding whether a failure should be
// retried by graphile-worker's own backoff, or left alone:
//   - ambiguous (we don't know if the platform received the post) -> do
//     NOT throw. The job completes "successfully" from the queue's point
//     of view; the post itself is left in PUBLISH_AMBIGUOUS for a human,
//     which is the whole point -- an automatic retry here is exactly the
//     duplicate-post risk this design exists to prevent.
//   - a normal, clean failure (platform rejected it, network error, etc.)
//     -> throw, so graphile-worker's bounded exponential backoff retries
//     it. lib/orchestrator/publish.ts's PublishAttempt bookkeeping is what
//     makes that retry safe.
const publishApprovedPostTask: Task = async (payload, helpers) => {
  const { postId } = payload as { postId: string };
  helpers.logger.info(`Publishing post ${postId} (attempt ${helpers.job.attempts}/${helpers.job.max_attempts})`);

  const result = await publish(postId);

  if (!result.ok && !result.ambiguous) {
    throw new Error(result.error || "Publish failed for an unknown reason.");
  }
  if (result.directPostError) {
    helpers.logger.warn(`Post ${postId} published via fallback -- Direct Post failed: ${result.directPostError}`);
  }
};

export default publishApprovedPostTask;
