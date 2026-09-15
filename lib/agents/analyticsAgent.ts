import { prisma } from "@/lib/db";
import { decryptToken } from "@/lib/crypto";
import { getMediaInsights, type MediaInsights } from "@/lib/agents/metaEcosystem";
import { logAudit } from "@/lib/audit";

// Level 3 Analytics Agent -- read-only, admin-triggered. Pulls real
// per-media insights for a published post and persists a snapshot. Never
// runs automatically (no cron/queue infra exists in this project), never
// affects the publish pipeline.
export async function refreshPostAnalytics(
  postId: string
): Promise<{ ok: boolean; insights?: MediaInsights; error?: string }> {
  const post = await prisma.socialPost.findUnique({
    where: { id: postId },
    include: { account: true },
  });

  if (!post) return { ok: false, error: `SocialPost ${postId} not found.` };
  if (post.status !== "PUBLISHED" || !post.externalMediaId) {
    return { ok: false, error: "Post is not PUBLISHED yet -- no live media to measure." };
  }

  const accessToken = decryptToken(post.account.accessTokenEncrypted);
  const result = await getMediaInsights(post.externalMediaId, accessToken, post.mediaType);

  if (!result.ok || !result.insights) {
    await logAudit({
      action: "social_post.analytics_refresh_failed",
      entity: "SocialPost",
      entityId: postId,
      metadata: { error: result.error },
    });
    return { ok: false, error: result.error || "Failed to fetch media insights." };
  }

  await prisma.postPerformance.create({
    data: {
      postId,
      likeCount: result.insights.likeCount,
      commentsCount: result.insights.commentsCount,
      savedCount: result.insights.savedCount,
      sharesCount: result.insights.sharesCount,
      reach: result.insights.reach,
      totalInteractions: result.insights.totalInteractions,
      raw: JSON.parse(JSON.stringify(result.insights.raw)),
      unavailableFields: result.insights.unavailableFields,
    },
  });

  await logAudit({
    action: "social_post.analytics_refreshed",
    entity: "SocialPost",
    entityId: postId,
    metadata: { totalInteractions: result.insights.totalInteractions, unavailableFields: result.insights.unavailableFields },
  });

  return { ok: true, insights: result.insights };
}
