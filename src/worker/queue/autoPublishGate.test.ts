import { describe, it, expect, vi, beforeEach } from "vitest";

// The spec requires fully-autonomous publishing to be behind BOTH a
// server-side env flag (default off) AND a per-account opt-in -- neither
// alone may have any effect. Since the server flag is read from
// process.env at module load time, each scenario re-imports the module
// fresh (vi.resetModules) after setting/unsetting the env var, rather than
// trying to mutate a already-evaluated constant.

const findUnique = vi.fn();
const socialPostUpdate = vi.fn(async () => undefined);
const enqueuePublishJob = vi.fn(async () => undefined);
const logAudit = vi.fn(async () => undefined);

vi.mock("@/src/worker/queue/db", () => ({
  workerPrisma: {
    automationSchedule: { findUnique },
    socialPost: { update: socialPostUpdate },
  },
}));
vi.mock("@/src/worker/queue/enqueue", () => ({ enqueuePublishJob }));
vi.mock("@/lib/audit", () => ({ logAudit }));

async function loadGate(envValue: string | undefined) {
  vi.resetModules();
  if (envValue === undefined) delete process.env.ENABLE_AUTONOMOUS_PUBLISH;
  else process.env.ENABLE_AUTONOMOUS_PUBLISH = envValue;
  const mod = await import("@/src/worker/queue/autoPublishGate");
  return mod.maybeAutoPublish;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("maybeAutoPublish dual gate", () => {
  it("does nothing when the server flag is unset, even if the account opted in", async () => {
    const maybeAutoPublish = await loadGate(undefined);
    findUnique.mockResolvedValue({ requireApproval: false });

    const result = await maybeAutoPublish("post-1", "sched-1");

    expect(result).toBe(false);
    expect(findUnique).not.toHaveBeenCalled(); // short-circuits before even touching the DB
    expect(enqueuePublishJob).not.toHaveBeenCalled();
  });

  it("does nothing when the server flag is on but the account still requires approval (the default)", async () => {
    const maybeAutoPublish = await loadGate("true");
    findUnique.mockResolvedValue({ requireApproval: true });

    const result = await maybeAutoPublish("post-1", "sched-1");

    expect(result).toBe(false);
    expect(enqueuePublishJob).not.toHaveBeenCalled();
    expect(socialPostUpdate).not.toHaveBeenCalled();
  });

  it("auto-approves and enqueues publish only when BOTH gates allow it", async () => {
    const maybeAutoPublish = await loadGate("true");
    findUnique.mockResolvedValue({ requireApproval: false });

    const result = await maybeAutoPublish("post-1", "sched-1");

    expect(result).toBe(true);
    expect(socialPostUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "post-1" }, data: { status: "APPROVED" } })
    );
    expect(enqueuePublishJob).toHaveBeenCalledWith("post-1");
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "social_post.auto_approved" }));
  });

  it("treats any non-'true' string (e.g. accidentally set to 'false') as off", async () => {
    const maybeAutoPublish = await loadGate("false");
    findUnique.mockResolvedValue({ requireApproval: false });

    const result = await maybeAutoPublish("post-1", "sched-1");

    expect(result).toBe(false);
    expect(enqueuePublishJob).not.toHaveBeenCalled();
  });
});
