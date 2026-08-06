import { prisma } from "@/lib/db";
import { decryptToken } from "@/lib/crypto";
import { publishInstagramPost } from "@/lib/agents/metaEcosystem";
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
  const result = await publishInstagramPost(post.account.externalAccountId, accessToken, {
    imageUrl: post.imageUrl,
    caption: post.caption,
  });

  if (result.ok && result.mediaId) {
    await prisma.socialPost.update({
      where: { id: postId },
      data: { status: "PUBLISHED", externalMediaId: result.mediaId, publishedAt: new Date() },
    });
    await logAudit({
      action: "social_post.published",
      entity: "SocialPost",
      entityId: postId,
      metadata: { externalMediaId: result.mediaId },
    });
    return { ok: true, mediaId: result.mediaId };
  }

  await prisma.socialPost.update({
    where: { id: postId },
    data: { status: "PUBLISH_FAILED" },
  });
  await logAudit({
    action: "social_post.publish_failed",
    entity: "SocialPost",
    entityId: postId,
    metadata: { error: result.error },
  });
  return { ok: false, error: result.error };
}
