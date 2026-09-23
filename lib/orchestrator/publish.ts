import { prisma } from "@/lib/db";
import { decryptToken } from "@/lib/crypto";
import { publishInstagramPost } from "@/lib/agents/metaEcosystem";
import { publishTikTokVideo } from "@/lib/agents/tiktokEcosystem";
import { logAudit } from "@/lib/audit";

// Runs only after an explicit human approval (Mode 1: nothing publishes
// without it). Separate from the draft LangGraph flow deliberately -- the
// gap between "approved" and "published" can be arbitrarily long (a human
// decides when to approve), so this is a plain function triggered by the
// approval API route rather than a paused/resumed graph execution, which
// would need a durable checkpointer this v1 doesn't have set up yet.
export async function publishApprovedPost(postId: string) {
  const post = await prisma.socialPost.findUnique({
    where: { id: postId },
    include: { account: true },
  });

  if (!post) throw new Error(`SocialPost ${postId} not found.`);
  if (post.status !== "APPROVED") {
    throw new Error(`SocialPost ${postId} is not APPROVED (status: ${post.status}) -- refusing to publish.`);
  }

  const accessToken = decryptToken(post.account.accessTokenEncrypted);
  const result =
    post.account.platform === "TIKTOK"
      ? await publishTikTokVideo(accessToken, {
          mediaUrl: post.mediaUrl,
          caption: post.caption,
          // Only the Video Agent path is actually AI-generated -- a raw
          // upload or a manually-pasted URL is the human's own footage.
          isAigc: Boolean(post.videoAgentProductionId),
        })
      : await publishInstagramPost(post.account.externalAccountId, accessToken, {
          mediaType: post.mediaType,
          mediaUrl: post.mediaUrl,
          caption: post.caption,
        });

  // TikTok-only: set when Direct Post (true auto-publish) was rejected and
  // the inbox/draft fallback saved the overall publish -- worth surfacing
  // even on success, since it's the only visibility into why Direct Post
  // keeps failing without it.
  const directPostError = "directPostError" in result ? result.directPostError : undefined;

  if (result.ok && result.mediaId) {
    await prisma.socialPost.update({
      where: { id: postId },
      data: { status: "PUBLISHED", externalMediaId: result.mediaId, publishedAt: new Date() },
    });
    await logAudit({
      action: "social_post.published",
      entity: "SocialPost",
      entityId: postId,
      metadata: { externalMediaId: result.mediaId, directPostError },
    });
    return { ok: true, mediaId: result.mediaId, directPostError };
  }

  await prisma.socialPost.update({
    where: { id: postId },
    data: { status: "PUBLISH_FAILED" },
  });
  await logAudit({
    action: "social_post.publish_failed",
    entity: "SocialPost",
    entityId: postId,
    metadata: { error: result.error, directPostError },
  });
  return { ok: false, error: result.error, directPostError };
}
