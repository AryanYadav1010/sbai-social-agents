import { prisma } from "@/lib/db";
import { decryptToken } from "@/lib/crypto";
import { runDraftGraph } from "@/lib/orchestrator/draftGraph";
import { getPerformanceHistorySummary } from "@/lib/agents/learningLoop";
import { logAudit } from "@/lib/audit";
import type { AudienceProfile } from "@/lib/agents/audienceAgent";

export interface CreateDraftResult {
  postId: string;
  status: "PENDING_APPROVAL" | "COMPLIANCE_REJECTED";
  caption: string;
  complianceReasons: string[];
}

export async function createDraftPost(opts: {
  accountId: string;
  topic: string;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  videoAgentProductionId?: string;
}): Promise<CreateDraftResult> {
  const account = await prisma.socialAccount.findUnique({ where: { id: opts.accountId } });
  if (!account) {
    throw new Error(`SocialAccount ${opts.accountId} not found.`);
  }

  const audienceProfile = (account.audienceProfile as AudienceProfile | null) ?? null;
  const performanceHistorySummary = await getPerformanceHistorySummary(opts.accountId);
  const accessToken = account.accessTokenEncrypted ? decryptToken(account.accessTokenEncrypted) : undefined;

  // FACEBOOK/YOUTUBE are reserved enum values for later phases (see
  // schema.prisma) -- no code path creates a SocialAccount with those yet,
  // so this narrowing always holds today.
  const { caption, complianceVerdict, trendSuggestion, audienceGuidance } = await runDraftGraph({
    topic: opts.topic,
    platform: account.platform as "INSTAGRAM" | "TIKTOK",
    accessToken,
    audienceProfile,
    performanceHistorySummary,
  });

  const status = complianceVerdict.passed ? "PENDING_APPROVAL" : "COMPLIANCE_REJECTED";

  const post = await prisma.socialPost.create({
    data: {
      accountId: opts.accountId,
      topic: opts.topic,
      mediaType: opts.mediaType,
      mediaUrl: opts.mediaUrl,
      videoAgentProductionId: opts.videoAgentProductionId,
      caption,
      status,
      complianceVerdict: JSON.parse(JSON.stringify(complianceVerdict)),
      trendContext: trendSuggestion ? JSON.parse(JSON.stringify(trendSuggestion)) : undefined,
      audienceContext: audienceGuidance ? JSON.parse(JSON.stringify(audienceGuidance)) : undefined,
    },
  });

  await logAudit({
    action: complianceVerdict.passed ? "social_post.drafted" : "social_post.compliance_rejected",
    entity: "SocialPost",
    entityId: post.id,
    metadata: { topic: opts.topic, complianceReasons: complianceVerdict.reasons },
  });

  return { postId: post.id, status, caption, complianceReasons: complianceVerdict.reasons };
}
