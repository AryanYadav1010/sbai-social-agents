import type { Task } from "graphile-worker";
import { workerPrisma } from "@/src/worker/queue/db";
import { decryptToken } from "@/lib/crypto";
import { runDraftGraph } from "@/lib/orchestrator/draftGraph";
import { planNextContentBrief } from "@/lib/orchestrator/planContent";
import { getPerformanceHistorySummary } from "@/lib/agents/learningLoop";
import { logAudit } from "@/lib/audit";
import type { AudienceProfile } from "@/lib/agents/audienceAgent";
import { maybeAutoPublish } from "@/src/worker/queue/autoPublishGate";

// The core autonomous-draft workflow (spec section "Autonomous draft
// workflow"). Imports and calls the exact same Trend/Audience/Content
// Creation/Compliance pipeline the human-driven dashboard form uses
// (lib/orchestrator/draftGraph.ts) -- nothing about drafting itself is
// reimplemented here, only the "decide what to draft and where the media
// comes from" steps that only make sense for an unattended run.
const generateSocialDraft: Task = async (payload, helpers) => {
  const { runId } = payload as { runId: string };

  const run = await workerPrisma.automationRun.findUnique({
    where: { id: runId },
    include: { schedule: { include: { account: true } } },
  });
  if (!run) throw new Error(`AutomationRun ${runId} not found.`);
  const { schedule } = run;
  const account = schedule.account;

  if (!schedule.enabled) {
    await workerPrisma.automationRun.update({ where: { id: runId }, data: { status: "SKIPPED", finishedAt: new Date() } });
    return;
  }

  // Daily cap -- count autonomous posts already created for this account
  // today (server-local calendar day is fine here; a schedule's own
  // postingTimes are what determine exact slots, this is just an outer
  // safety bound per the spec's cost-protection requirement).
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const countToday = await workerPrisma.socialPost.count({
    where: { accountId: account.id, automationRunId: { not: null }, createdAt: { gte: startOfDay } },
  });
  if (countToday >= schedule.postsPerDay) {
    await workerPrisma.automationRun.update({
      where: { id: runId },
      data: { status: "SKIPPED", error: `Daily cap (${schedule.postsPerDay}) already reached.`, finishedAt: new Date() },
    });
    return;
  }

  await workerPrisma.automationRun.update({ where: { id: runId }, data: { status: "PLANNING" } });

  const audienceProfile = (account.audienceProfile as AudienceProfile | null) ?? null;
  const performanceHistorySummary = await getPerformanceHistorySummary(account.id);

  const brief = await planNextContentBrief({
    accountId: account.id,
    platform: account.platform as "INSTAGRAM" | "TIKTOK" | "X",
    contentPillars: schedule.contentPillars,
    campaignBrief: schedule.campaignBrief,
    defaultInstructions: schedule.defaultInstructions,
    audienceProfile,
    performanceHistorySummary,
  });

  await workerPrisma.automationRun.update({
    where: { id: runId },
    data: {
      status: "GENERATING_DRAFT",
      plannedTopic: brief.topic,
      planMetadata: JSON.parse(JSON.stringify({ pillarUsed: brief.pillarUsed, reasoning: brief.reasoning, avoidedTopicsCount: brief.avoidedTopics.length })),
    },
  });
  await logAudit({
    action: "automation.plan_completed",
    entity: "AutomationRun",
    entityId: runId,
    metadata: { topic: brief.topic, pillarUsed: brief.pillarUsed },
  });

  // Media resolution order deliberately differs from the human dashboard
  // flow: a human always picks media before this runs, so
  // createDraftPost/runDraftGraph never had to think about it. Here:
  //   - non-Video-Agent schedules pick a pre-approved asset synchronously
  //     (no async wait needed), so it's resolved up front, same order as
  //     the human flow.
  //   - Video Agent schedules can't resolve media synchronously (the
  //     render takes real time), so caption/compliance run first and
  //     media is handled after -- matching the spec's own step ordering.
  let mediaUrl = "";
  let mediaType: "IMAGE" | "VIDEO" = schedule.useVideoAgent ? "VIDEO" : "IMAGE";

  if (!schedule.useVideoAgent) {
    const asset = await pickRandomAsset(account.id);
    if (!asset) {
      await createNeedsMediaPost(runId, account.id, brief.topic);
      await workerPrisma.automationRun.update({
        where: { id: runId },
        data: { status: "FAILED", error: "No approved media assets configured for this account.", finishedAt: new Date() },
      });
      return;
    }
    mediaUrl = asset.url;
    mediaType = asset.kind === "video" ? "VIDEO" : "IMAGE";
  }

  const accessToken = account.accessTokenEncrypted ? decryptToken(account.accessTokenEncrypted) : undefined;
  const { caption, complianceVerdict, trendSuggestion, audienceGuidance } = await runDraftGraph({
    topic: brief.topic,
    platform: account.platform as "INSTAGRAM" | "TIKTOK" | "X",
    accessToken,
    audienceProfile,
    performanceHistorySummary,
  });

  await logAudit({
    action: complianceVerdict.passed ? "automation.compliance_passed" : "automation.compliance_blocked",
    entity: "AutomationRun",
    entityId: runId,
    metadata: { reasons: complianceVerdict.reasons },
  });

  if (schedule.useVideoAgent) {
    if (!complianceVerdict.passed) {
      // Compliance already rejected this topic -- deliberately do NOT
      // spend a Video Agent render on content that can't be published
      // anyway (cost protection). The rejected draft is still saved so
      // it's visible/auditable, with an empty mediaUrl placeholder.
      const post = await workerPrisma.socialPost.create({
        data: {
          accountId: account.id,
          topic: brief.topic,
          mediaType,
          mediaUrl: "",
          caption,
          status: "COMPLIANCE_REJECTED",
          complianceVerdict: JSON.parse(JSON.stringify(complianceVerdict)),
          trendContext: trendSuggestion ? JSON.parse(JSON.stringify(trendSuggestion)) : undefined,
          audienceContext: audienceGuidance ? JSON.parse(JSON.stringify(audienceGuidance)) : undefined,
          automationRunId: runId,
        },
      });
      await workerPrisma.automationRun.update({ where: { id: runId }, data: { status: "FAILED", error: "Compliance rejected.", finishedAt: new Date() } });
      await logAudit({ action: "social_post.compliance_rejected", entity: "SocialPost", entityId: post.id, metadata: { automationRunId: runId } });
      return;
    }

    const post = await workerPrisma.socialPost.create({
      data: {
        accountId: account.id,
        topic: brief.topic,
        mediaType: "VIDEO",
        mediaUrl: "",
        caption,
        status: "GENERATING_MEDIA",
        complianceVerdict: JSON.parse(JSON.stringify(complianceVerdict)),
        trendContext: trendSuggestion ? JSON.parse(JSON.stringify(trendSuggestion)) : undefined,
        audienceContext: audienceGuidance ? JSON.parse(JSON.stringify(audienceGuidance)) : undefined,
        automationRunId: runId,
      },
    });
    await workerPrisma.automationRun.update({ where: { id: runId }, data: { status: "AWAITING_VIDEO" } });
    await helpers.addJob(
      "generateVideo",
      { postId: post.id, runId, topic: brief.topic, accountId: account.id },
      { jobKey: `video:${post.id}`, maxAttempts: 3 }
    );
    return;
  }

  // Non-Video-Agent path: media already resolved above, save the complete
  // draft in one go, same as the human dashboard flow.
  const status = complianceVerdict.passed ? "PENDING_APPROVAL" : "COMPLIANCE_REJECTED";
  const post = await workerPrisma.socialPost.create({
    data: {
      accountId: account.id,
      topic: brief.topic,
      mediaType,
      mediaUrl,
      caption,
      status,
      complianceVerdict: JSON.parse(JSON.stringify(complianceVerdict)),
      trendContext: trendSuggestion ? JSON.parse(JSON.stringify(trendSuggestion)) : undefined,
      audienceContext: audienceGuidance ? JSON.parse(JSON.stringify(audienceGuidance)) : undefined,
      automationRunId: runId,
    },
  });
  await workerPrisma.automationRun.update({
    where: { id: runId },
    data: { status: complianceVerdict.passed ? "PENDING_APPROVAL" : "FAILED", finishedAt: new Date() },
  });
  await logAudit({
    action: complianceVerdict.passed ? "social_post.drafted" : "social_post.compliance_rejected",
    entity: "SocialPost",
    entityId: post.id,
    metadata: { automationRunId: runId, topic: brief.topic },
  });

  if (complianceVerdict.passed) {
    await maybeAutoPublish(post.id, schedule.id);
  }
};

async function pickRandomAsset(accountId: string) {
  const assets = await workerPrisma.mediaAsset.findMany({ where: { accountId } });
  if (assets.length === 0) return null;
  return assets[Math.floor(Math.random() * assets.length)];
}

async function createNeedsMediaPost(runId: string, accountId: string, topic: string) {
  const post = await workerPrisma.socialPost.create({
    data: {
      accountId,
      topic,
      mediaType: "IMAGE",
      mediaUrl: "",
      caption: "",
      status: "NEEDS_MEDIA",
      automationRunId: runId,
    },
  });
  await logAudit({ action: "automation.needs_media", entity: "SocialPost", entityId: post.id, metadata: { automationRunId: runId } });
}

export default generateSocialDraft;
