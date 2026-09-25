import { describe, it, expect, vi, beforeEach } from "vitest";

// Covers the cost-protection and media-handling branches of the core
// autonomous-draft workflow: a disabled schedule or an already-reached
// daily cap must generate zero AI/API calls, and the Video Agent path must
// never waste a render on content Compliance has already rejected. Mocked
// at the Prisma/agent layer so this runs without a database, an Anthropic
// key, or a real Video Agent service.

const automationRunFindUnique = vi.fn();
const automationRunUpdate = vi.fn(async () => undefined);
const socialPostCount = vi.fn();
const socialPostCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "post-1", ...args.data }));
const mediaAssetFindMany = vi.fn();

vi.mock("@/src/worker/queue/db", () => ({
  workerPrisma: {
    automationRun: { findUnique: automationRunFindUnique, update: automationRunUpdate },
    socialPost: { count: socialPostCount, create: socialPostCreate },
    mediaAsset: { findMany: mediaAssetFindMany },
  },
}));

const decryptToken = vi.fn(() => "plaintext-token");
vi.mock("@/lib/crypto", () => ({ decryptToken }));

const runDraftGraph = vi.fn();
vi.mock("@/lib/orchestrator/draftGraph", () => ({ runDraftGraph }));

const planNextContentBrief = vi.fn();
vi.mock("@/lib/orchestrator/planContent", () => ({ planNextContentBrief }));

const getPerformanceHistorySummary = vi.fn(async () => "");
vi.mock("@/lib/agents/learningLoop", () => ({ getPerformanceHistorySummary }));

const logAudit = vi.fn(async () => undefined);
vi.mock("@/lib/audit", () => ({ logAudit }));

const maybeAutoPublish = vi.fn(async () => false);
vi.mock("@/src/worker/queue/autoPublishGate", () => ({ maybeAutoPublish }));

const { default: generateSocialDraft } = await import("@/src/worker/tasks/generateSocialDraft");

function makeHelpers() {
  return { addJob: vi.fn(async () => undefined), logger: { info: vi.fn(), error: vi.fn() } };
}

function baseRun(scheduleOverrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    schedule: {
      id: "sched-1",
      enabled: true,
      postsPerDay: 3,
      useVideoAgent: false,
      contentPillars: ["tips"],
      campaignBrief: "",
      defaultInstructions: "",
      account: { id: "acct-1", platform: "INSTAGRAM", audienceProfile: null },
      ...scheduleOverrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  decryptToken.mockReturnValue("plaintext-token");
  planNextContentBrief.mockResolvedValue({ topic: "Behind the scenes", pillarUsed: "tips", reasoning: "rotation", avoidedTopics: [] });
});

describe("generateSocialDraft", () => {
  it("does nothing when the schedule has been disabled since the slot was claimed", async () => {
    automationRunFindUnique.mockResolvedValue(baseRun({ enabled: false }));
    const helpers = makeHelpers();

    await generateSocialDraft({ runId: "run-1" }, helpers as never);

    expect(automationRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SKIPPED" }) })
    );
    expect(planNextContentBrief).not.toHaveBeenCalled();
    expect(helpers.addJob).not.toHaveBeenCalled();
  });

  it("skips generating anything once the daily cap is already reached (cost protection)", async () => {
    automationRunFindUnique.mockResolvedValue(baseRun({ postsPerDay: 2 }));
    socialPostCount.mockResolvedValue(2);
    const helpers = makeHelpers();

    await generateSocialDraft({ runId: "run-1" }, helpers as never);

    expect(automationRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SKIPPED", error: expect.stringContaining("Daily cap") }) })
    );
    expect(planNextContentBrief).not.toHaveBeenCalled();
  });

  it("marks the post NEEDS_MEDIA and fails the run when no approved media assets exist (non-video path)", async () => {
    automationRunFindUnique.mockResolvedValue(baseRun());
    socialPostCount.mockResolvedValue(0);
    mediaAssetFindMany.mockResolvedValue([]);
    const helpers = makeHelpers();

    await generateSocialDraft({ runId: "run-1" }, helpers as never);

    expect(socialPostCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "NEEDS_MEDIA" }) })
    );
    expect(automationRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
    expect(runDraftGraph).not.toHaveBeenCalled();
  });

  it("creates a PENDING_APPROVAL post and tries the auto-publish gate when compliance passes (non-video path)", async () => {
    automationRunFindUnique.mockResolvedValue(baseRun());
    socialPostCount.mockResolvedValue(0);
    mediaAssetFindMany.mockResolvedValue([{ id: "asset-1", url: "https://example.com/a.jpg", kind: "image" }]);
    runDraftGraph.mockResolvedValue({ caption: "hello", complianceVerdict: { passed: true, reasons: [] } });
    const helpers = makeHelpers();

    await generateSocialDraft({ runId: "run-1" }, helpers as never);

    expect(socialPostCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PENDING_APPROVAL" }) })
    );
    expect(maybeAutoPublish).toHaveBeenCalledWith("post-1", "sched-1");
  });

  it("does not spend a Video Agent render on content Compliance already rejected", async () => {
    automationRunFindUnique.mockResolvedValue(baseRun({ useVideoAgent: true }));
    socialPostCount.mockResolvedValue(0);
    runDraftGraph.mockResolvedValue({ caption: "bad", complianceVerdict: { passed: false, reasons: ["banned claim"] } });
    const helpers = makeHelpers();

    await generateSocialDraft({ runId: "run-1" }, helpers as never);

    expect(socialPostCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLIANCE_REJECTED", mediaUrl: "" }) })
    );
    expect(helpers.addJob).not.toHaveBeenCalledWith("generateVideo", expect.anything(), expect.anything());
    expect(maybeAutoPublish).not.toHaveBeenCalled();
  });

  it("hands off to generateVideo when compliance passes on the Video Agent path", async () => {
    automationRunFindUnique.mockResolvedValue(baseRun({ useVideoAgent: true }));
    socialPostCount.mockResolvedValue(0);
    runDraftGraph.mockResolvedValue({ caption: "great content", complianceVerdict: { passed: true, reasons: [] } });
    const helpers = makeHelpers();

    await generateSocialDraft({ runId: "run-1" }, helpers as never);

    expect(socialPostCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "GENERATING_MEDIA" }) })
    );
    expect(helpers.addJob).toHaveBeenCalledWith(
      "generateVideo",
      expect.objectContaining({ postId: "post-1" }),
      expect.anything()
    );
    expect(automationRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "AWAITING_VIDEO" }) })
    );
  });
});
