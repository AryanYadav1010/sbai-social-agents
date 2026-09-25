import type { Task } from "graphile-worker";
import { workerPrisma } from "@/src/worker/queue/db";
import { computeNextRunAt } from "@/src/worker/queue/schedule";
import { logAudit } from "@/lib/audit";

// Runs once a minute via graphile-worker's own crontab feature (see
// src/worker/index.ts) -- NOT once per worker node. Graphile Worker's cron
// implementation already guarantees a given cron tick is only ever
// enqueued once cluster-wide, but the claim below is still done with a
// real DB-level unique constraint (AutomationRun.idempotencyKey) rather
// than trusting that alone, per the "deterministic job/idempotency keys"
// requirement -- defense in depth, not redundant caution.
const schedulerTick: Task = async (_payload, helpers) => {
  const now = new Date();

  const due = await workerPrisma.automationSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
  });

  if (due.length === 0) return;

  for (const schedule of due) {
    const slotInstant = schedule.nextRunAt as Date;
    const idempotencyKey = `${schedule.id}:${slotInstant.toISOString()}`;

    const nextRunAt = computeNextRunAt(new Date(slotInstant.getTime() + 60_000), {
      timezone: schedule.timezone,
      allowedDays: schedule.allowedDays,
      postingTimes: schedule.postingTimes,
    });

    try {
      const run = await workerPrisma.$transaction(async (tx) => {
        // The unique constraint on idempotencyKey is what makes this safe
        // under a race -- if two ticks somehow both reach here for the
        // same slot, the second create() throws P2002 and is caught below.
        const created = await tx.automationRun.create({
          data: { scheduleId: schedule.id, idempotencyKey, status: "QUEUED" },
        });
        await tx.automationSchedule.update({
          where: { id: schedule.id },
          data: { nextRunAt, lastRunAt: now },
        });
        return created;
      });

      await helpers.addJob(
        "generateSocialDraft",
        { runId: run.id },
        { jobKey: `run:${run.id}`, jobKeyMode: "preserve_run_at", maxAttempts: 3 }
      );

      await logAudit({
        action: "automation.run_queued",
        entity: "AutomationRun",
        entityId: run.id,
        metadata: { scheduleId: schedule.id, slot: slotInstant.toISOString() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      if (message.includes("Unique constraint")) {
        // Already claimed by another tick/node for this exact slot --
        // expected under the race this whole scheme defends against, not
        // a real failure.
        helpers.logger.info(`Slot ${idempotencyKey} already claimed, skipping.`);
        continue;
      }
      helpers.logger.error(`Failed to claim schedule ${schedule.id}: ${message}`);
      await workerPrisma.automationSchedule.update({
        where: { id: schedule.id },
        data: { lastError: message },
      });
    }
  }
};

export default schedulerTick;
