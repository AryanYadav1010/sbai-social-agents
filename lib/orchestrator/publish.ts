import { prisma } from "@/lib/db";
import { getUsableAccessToken } from "@/lib/orchestrator/tokens";
import { publishInstagramPost } from "@/lib/agents/metaEcosystem";
import { publishTikTokVideo } from "@/lib/agents/tiktokEcosystem";
import { publishXPost } from "@/lib/agents/xEcosystem";
import { logAudit } from "@/lib/audit";

export interface PublishOutcome {
  ok: boolean;
  mediaId?: string;
  error?: string;
  directPostError?: string;
  // true only for the "we genuinely don't know if the platform received
  // the post" case -- the caller (the worker task) must NOT treat this as
  // retryable, since retrying could create a duplicate live post. Every
  // other failure shape is safe to retry.
  ambiguous?: boolean;
}

// Runs only after an explicit human approval (Mode 1: nothing publishes
// without it) -- or, now that publishing goes through the durable worker
// queue (see src/worker/tasks/publishApprovedPost.ts), after the queue job
// for an already-approved post is picked up.
//
// Idempotency: a durable queue gives at-least-once execution, so this
// function can run more than once for the same post if a worker dies
// mid-call. The PublishAttempt row (unique on postId) is how that's made
// safe:
//   - no existing attempt, or existing attempt is FAILED -> we know
//     exactly what happened last time (a clean error response came back),
//     safe to call the platform again.
//   - existing attempt is IN_PROGRESS -> the *previous* call's outcome was
//     never recorded, which only happens if the process died between
//     sending the platform request and writing the result. We do not know
//     whether that request actually reached the platform, so we refuse to
//     call it again and surface PUBLISH_AMBIGUOUS for a human to check the
//     real account instead of risking a duplicate live post.
//   - existing attempt is SUCCEEDED -> already done; short-circuit.
export async function publishApprovedPost(postId: string): Promise<PublishOutcome> {
  const post = await prisma.socialPost.findUnique({
    where: { id: postId },
    include: { account: true, publishAttempt: true },
  });

  if (!post) throw new Error(`SocialPost ${postId} not found.`);
  if (post.status !== "APPROVED") {
    throw new Error(`SocialPost ${postId} is not APPROVED (status: ${post.status}) -- refusing to publish.`);
  }

  if (post.publishAttempt?.status === "SUCCEEDED") {
    return { ok: true, mediaId: post.externalMediaId ?? undefined };
  }

  if (post.publishAttempt?.status === "IN_PROGRESS") {
    await prisma.socialPost.update({ where: { id: postId }, data: { status: "PUBLISH_AMBIGUOUS" } });
    await logAudit({
      action: "social_post.publish_ambiguous",
      entity: "SocialPost",
      entityId: postId,
      metadata: { reason: "A previous publish attempt never recorded a result (worker likely died mid-call) -- refusing to auto-retry the platform call." },
    });
    return { ok: false, ambiguous: true, error: "A previous publish attempt for this post never completed, and we cannot tell whether it reached the platform. Check the account manually, then resolve this from the dashboard." };
  }

  // Decrypt BEFORE marking IN_PROGRESS, not after: a corrupt/invalid
  // stored token throws here, and that failure is unambiguous -- the
  // platform was never contacted, so it must be a normal, retryable
  // FAILED, not the "we don't know what happened" ambiguous state that
  // IN_PROGRESS represents. Only the actual network call below should
  // ever be able to leave an attempt looking ambiguous.
  let accessToken: string;
  try {
    accessToken = await getUsableAccessToken(post.account);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to obtain a usable access token.";
    await prisma.$transaction([
      prisma.socialPost.update({ where: { id: postId }, data: { status: "PUBLISH_FAILED" } }),
      prisma.publishAttempt.upsert({
        where: { postId },
        create: { postId, status: "FAILED", error: message, finishedAt: new Date() },
        update: { status: "FAILED", error: message, finishedAt: new Date() },
      }),
    ]);
    await logAudit({ action: "social_post.publish_failed", entity: "SocialPost", entityId: postId, metadata: { error: message } });
    return { ok: false, error: message };
  }

  // Claim/reset the attempt row to IN_PROGRESS *immediately* before the
  // actual network call -- this is the write that, if the process dies
  // right after the platform call but before we get back here, leaves the
  // row visibly IN_PROGRESS for the next run to detect.
  await prisma.publishAttempt.upsert({
    where: { postId },
    create: { postId, status: "IN_PROGRESS" },
    update: { status: "IN_PROGRESS", error: null, finishedAt: null },
  });

  const result =
    post.account.platform === "TIKTOK"
      ? await publishTikTokVideo(accessToken, {
          mediaUrl: post.mediaUrl,
          caption: post.caption,
          // Only the Video Agent path is actually AI-generated -- a raw
          // upload or a manually-pasted URL is the human's own footage.
          isAigc: Boolean(post.videoAgentProductionId),
        })
      : post.account.platform === "X"
      ? await publishXPost(accessToken, { mediaUrl: post.mediaUrl, caption: post.caption, mediaType: post.mediaType })
      : await publishInstagramPost(post.account.externalAccountId, accessToken, {
          mediaType: post.mediaType,
          mediaUrl: post.mediaUrl,
          caption: post.caption,
        });

  // TikTok-only: set when Direct Post (true auto-publish) was rejected and
  // the inbox/draft fallback saved the overall publish -- worth surfacing
  // even on success, since it's the only visibility into why Direct Post
  // keeps failing without it.
  const directPostError: string | undefined =
    "directPostError" in result && typeof result.directPostError === "string" ? result.directPostError : undefined;

  if (result.ok && result.mediaId) {
    await prisma.$transaction([
      prisma.socialPost.update({
        where: { id: postId },
        data: { status: "PUBLISHED", externalMediaId: result.mediaId, publishedAt: new Date() },
      }),
      prisma.publishAttempt.update({
        where: { postId },
        data: { status: "SUCCEEDED", finishedAt: new Date() },
      }),
    ]);
    await logAudit({
      action: "social_post.published",
      entity: "SocialPost",
      entityId: postId,
      metadata: { externalMediaId: result.mediaId, directPostError },
    });
    return { ok: true, mediaId: result.mediaId, directPostError };
  }

  // A clean (if unsuccessful) response came back -- we know this attempt
  // did not create a live post, so it's safe to mark FAILED and allow a
  // future retry to call the platform again.
  await prisma.$transaction([
    prisma.socialPost.update({ where: { id: postId }, data: { status: "PUBLISH_FAILED" } }),
    prisma.publishAttempt.update({
      where: { postId },
      data: { status: "FAILED", error: result.error?.slice(0, 2000), finishedAt: new Date() },
    }),
  ]);
  await logAudit({
    action: "social_post.publish_failed",
    entity: "SocialPost",
    entityId: postId,
    metadata: { error: result.error, directPostError },
  });
  return { ok: false, error: result.error, directPostError };
}
