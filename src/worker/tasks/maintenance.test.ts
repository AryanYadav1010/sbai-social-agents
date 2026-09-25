import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMany = vi.fn();
vi.mock("@/src/worker/queue/db", () => ({
  workerPrisma: { workerNode: { updateMany } },
}));

const { default: maintenance } = await import("@/src/worker/tasks/maintenance");

function makeHelpers() {
  return { logger: { info: vi.fn(), error: vi.fn() } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("maintenance", () => {
  it("marks only ONLINE nodes with a stale heartbeat as OFFLINE", async () => {
    updateMany.mockResolvedValue({ count: 2 });
    const helpers = makeHelpers();

    await maintenance({}, helpers as never);

    expect(updateMany).toHaveBeenCalledWith({
      where: { status: "ONLINE", lastHeartbeatAt: { lt: expect.any(Date) } },
      data: { status: "OFFLINE" },
    });
    expect(helpers.logger.info).toHaveBeenCalledWith(expect.stringContaining("2 worker node"));
  });

  it("stays quiet when nothing was stale", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    const helpers = makeHelpers();

    await maintenance({}, helpers as never);

    expect(helpers.logger.info).not.toHaveBeenCalled();
  });
});
