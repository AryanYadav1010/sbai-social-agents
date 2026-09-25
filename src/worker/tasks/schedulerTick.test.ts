import { describe, it, expect, vi, beforeEach } from "vitest";

// Graphile Worker's cron feature already dedupes a given tick cluster-wide,
// but schedulerTick also claims each due schedule via a DB-level unique
// constraint on AutomationRun.idempotencyKey as defense in depth -- this is
// what actually prevents two worker processes (e.g. two Mac minis) from
// both producing a draft for the same scheduled slot. Mocked at the Prisma
// layer so this runs without a real database.

const findMany = vi.fn();
const automationRunCreate = vi.fn();
const automationScheduleUpdate = vi.fn();
const scheduleUpdateOutsideTx = vi.fn();

const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    automationRun: { create: automationRunCreate },
    automationSchedule: { update: automationScheduleUpdate },
  })
);

vi.mock("@/src/worker/queue/db", () => ({
  workerPrisma: {
    automationSchedule: { findMany, update: scheduleUpdateOutsideTx },
    $transaction: transaction,
  },
}));

const logAudit = vi.fn(async () => undefined);
vi.mock("@/lib/audit", () => ({ logAudit }));

const { default: schedulerTick } = await import("@/src/worker/tasks/schedulerTick");

function makeHelpers() {
  return {
    addJob: vi.fn(async () => undefined),
    logger: { info: vi.fn(), error: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("schedulerTick", () => {
  it("does nothing when no schedules are due", async () => {
    findMany.mockResolvedValue([]);
    const helpers = makeHelpers();

    await schedulerTick({}, helpers as never);

    expect(transaction).not.toHaveBeenCalled();
    expect(helpers.addJob).not.toHaveBeenCalled();
  });

  it("claims a due schedule with a slot-derived idempotency key and enqueues exactly one draft job", async () => {
    const nextRunAt = new Date("2026-09-25T11:00:00.000Z");
    findMany.mockResolvedValue([
      { id: "sched-1", nextRunAt, timezone: "Europe/London", allowedDays: [0, 1, 2, 3, 4, 5, 6], postingTimes: ["12:00"] },
    ]);
    automationRunCreate.mockResolvedValue({ id: "run-1" });
    const helpers = makeHelpers();

    await schedulerTick({}, helpers as never);

    expect(automationRunCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scheduleId: "sched-1", idempotencyKey: `sched-1:${nextRunAt.toISOString()}`, status: "QUEUED" }),
      })
    );
    expect(helpers.addJob).toHaveBeenCalledTimes(1);
    expect(helpers.addJob).toHaveBeenCalledWith(
      "generateSocialDraft",
      { runId: "run-1" },
      expect.objectContaining({ jobKey: "run:run-1" })
    );
  });

  it("treats a unique-constraint race on the same slot as an expected skip, not an error", async () => {
    findMany.mockResolvedValue([
      { id: "sched-1", nextRunAt: new Date(), timezone: "UTC", allowedDays: [0, 1, 2, 3, 4, 5, 6], postingTimes: ["12:00"] },
    ]);
    automationRunCreate.mockRejectedValue(new Error("Unique constraint failed on the fields: (`idempotencyKey`)"));
    const helpers = makeHelpers();

    await expect(schedulerTick({}, helpers as never)).resolves.not.toThrow();

    expect(helpers.addJob).not.toHaveBeenCalled();
    expect(helpers.logger.error).not.toHaveBeenCalled();
    expect(scheduleUpdateOutsideTx).not.toHaveBeenCalled(); // not recorded as a real failure
  });

  it("records a real (non-race) claim failure on the schedule's lastError without crashing the whole tick", async () => {
    findMany.mockResolvedValue([
      { id: "sched-1", nextRunAt: new Date(), timezone: "UTC", allowedDays: [0, 1, 2, 3, 4, 5, 6], postingTimes: ["12:00"] },
    ]);
    automationRunCreate.mockRejectedValue(new Error("connection reset"));
    const helpers = makeHelpers();

    await expect(schedulerTick({}, helpers as never)).resolves.not.toThrow();

    expect(helpers.addJob).not.toHaveBeenCalled();
    expect(scheduleUpdateOutsideTx).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sched-1" }, data: expect.objectContaining({ lastError: "connection reset" }) })
    );
  });
});
