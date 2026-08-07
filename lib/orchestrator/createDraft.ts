import { prisma } from "@/lib/db";
import { runDraftGraph } from "@/lib/orchestrator/draftGraph";
import { logAudit } from "@/lib/audit";

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
  const { caption, complianceVerdict } = await runDraftGraph(opts.topic);

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
