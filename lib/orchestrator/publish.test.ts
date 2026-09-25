import { describe, it, expect, vi, beforeEach } from "vitest";

// This is the most safety-critical piece of the whole always-on worker:
// publishApprovedPost() must never let a retried (at-least-once) queue job
// create a duplicate real-world post. Every branch below is a state the
// PublishAttempt row can be in when this function starts, mocked at the
// Prisma layer so the test exercises the real decision logic without a
// database or any real network call to a platform.

const findUnique = vi.fn();
const socialPostUpdate = vi.fn(async (args: unknown) => args);
const publishAttemptUpsert = vi.fn(async (args: unknown) => args);
const publishAttemptUpdate = vi.fn(async (args: unknown) => args);
const transaction = vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops));

vi.mock("@/lib/db", () => ({
  prisma: {
    socialPost: { findUnique, update: socialPostUpdate },
    publishAttempt: { upsert: publishAttemptUpsert, update: publishAttemptUpdate },
    $transaction: transaction,
  },
}));

const getUsableAccessToken = vi.fn();
vi.mock("@/lib/orchestrator/tokens", () => ({ getUsableAccessToken }));

const logAudit = vi.fn(async () => undefined);
vi.mock("@/lib/audit", () => ({ logAudit }));

const publishInstagramPost = vi.fn();
vi.mock("@/lib/agents/metaEcosystem", () => ({ publishInstagramPost }));

const publishTikTokVideo = vi.fn();
vi.mock("@/lib/agents/tiktokEcosystem", () => ({ publishTikTokVideo }));

const publishXPost = vi.fn();
vi.mock("@/lib/agents/xEcosystem", () => ({ publishXPost }));

const { publishApprovedPost } = await import("@/lib/orchestrator/publish");

function basePost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    status: "APPROVED",
    mediaUrl: "https://example.com/a.jpg",
    mediaType: "IMAGE",
    caption: "hello",
    externalMediaId: null,
    videoAgentProductionId: null,
    publishAttempt: null,
    account: {
      platform: "INSTAGRAM",
      externalAccountId: "ig-123",
      accessTokenEncrypted: "encrypted-token",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUsableAccessToken.mockReturnValue("plaintext-token");
});

describe("publishApprovedPost idempotency", () => {
  it("short-circuits without calling the platform when a previous attempt already SUCCEEDED", async () => {
    findUnique.mockResolvedValue(basePost({ externalMediaId: "media-1", publishAttempt: { status: "SUCCEEDED" } }));

    const result = await publishApprovedPost("post-1");

    expect(result).toEqual({ ok: true, mediaId: "media-1" });
    expect(publishInstagramPost).not.toHaveBeenCalled();
    expect(publishAttemptUpsert).not.toHaveBeenCalled();
  });

  it("refuses to retry and returns ambiguous when a previous attempt is stuck IN_PROGRESS", async () => {
    findUnique.mockResolvedValue(basePost({ publishAttempt: { status: "IN_PROGRESS" } }));

    const result = await publishApprovedPost("post-1");

    expect(result.ok).toBe(false);
    expect(result.ambiguous).toBe(true);
    expect(publishInstagramPost).not.toHaveBeenCalled();
    expect(socialPostUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PUBLISH_AMBIGUOUS" }) })
    );
  });

  it("marks a token decrypt failure as a normal retryable FAILED, not ambiguous, and never calls the platform", async () => {
    findUnique.mockResolvedValue(basePost());
    getUsableAccessToken.mockImplementation(() => {
      throw new Error("bad ciphertext");
    });

    const result = await publishApprovedPost("post-1");

    expect(result.ok).toBe(false);
    expect(result.ambiguous).toBeUndefined();
    expect(publishInstagramPost).not.toHaveBeenCalled();
    // Crucially: the attempt is marked FAILED directly, never IN_PROGRESS --
    // a decrypt failure never touched the network, so it's unambiguous.
    expect(publishAttemptUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: "FAILED" }) })
    );
    expect(socialPostUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PUBLISH_FAILED" }) })
    );
  });

  it("marks a clean platform failure response as FAILED (safe to retry)", async () => {
    findUnique.mockResolvedValue(basePost());
    publishInstagramPost.mockResolvedValue({ ok: false, error: "Graph API error 400" });

    const result = await publishApprovedPost("post-1");

    expect(result).toEqual({ ok: false, error: "Graph API error 400", directPostError: undefined });
    // First call marks the attempt IN_PROGRESS before the platform call;
    // second call (post-failure) records the terminal FAILED state.
    expect(publishAttemptUpsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ create: expect.objectContaining({ status: "IN_PROGRESS" }) })
    );
    expect(publishAttemptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
    expect(socialPostUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PUBLISH_FAILED" }) })
    );
  });

  it("marks a genuine success as PUBLISHED + SUCCEEDED and records the external media id", async () => {
    findUnique.mockResolvedValue(basePost());
    publishInstagramPost.mockResolvedValue({ ok: true, mediaId: "media-99" });

    const result = await publishApprovedPost("post-1");

    expect(result).toEqual({ ok: true, mediaId: "media-99", directPostError: undefined });
    expect(socialPostUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PUBLISHED", externalMediaId: "media-99" }) })
    );
    expect(publishAttemptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED" }) })
    );
  });

  it("refuses to publish a post that isn't APPROVED, regardless of PublishAttempt state", async () => {
    findUnique.mockResolvedValue(basePost({ status: "PENDING_APPROVAL" }));

    await expect(publishApprovedPost("post-1")).rejects.toThrow(/not APPROVED/);
    expect(publishInstagramPost).not.toHaveBeenCalled();
  });

  it("dispatches to the TikTok publisher for a TIKTOK account and surfaces directPostError on success", async () => {
    findUnique.mockResolvedValue(
      basePost({ account: { platform: "TIKTOK", externalAccountId: "tt-1", accessTokenEncrypted: "enc" } })
    );
    publishTikTokVideo.mockResolvedValue({ ok: true, mediaId: "tt-media-1", directPostError: "Direct Post rejected: app not audited" });

    const result = await publishApprovedPost("post-1");

    expect(publishTikTokVideo).toHaveBeenCalled();
    expect(publishXPost).not.toHaveBeenCalled();
    expect(result.directPostError).toBe("Direct Post rejected: app not audited");
  });
});
