import type { Task } from "graphile-worker";
import { workerPrisma } from "@/src/worker/queue/db";

// Thin wrapper for the dashboard's manual "Run now" button -- creates a
// one-off AutomationRun (not deduped against a schedule slot, since a
// manual click is an explicit one-time request, not a recurring
// occurrence) and hands off to the same generateSocialDraft task the
// scheduler itself uses, so there is exactly one code path for "produce an
// autonomous draft," not two.
const runScheduleNow: Task = async (payload, helpers) => {
  const { scheduleId } = payload as { scheduleId: string };

  const schedule = await workerPrisma.automationSchedule.findUnique({ where: { id: scheduleId } });
  if (!schedule) throw new Error(`AutomationSchedule ${scheduleId} not found.`);

  const run = await workerPrisma.automationRun.create({
    data: {
      scheduleId,
      idempotencyKey: `manual:${scheduleId}:${Date.now()}`,
      status: "QUEUED",
    },
  });

  await helpers.addJob(
    "generateSocialDraft",
    { runId: run.id },
    { jobKey: `run:${run.id}`, jobKeyMode: "preserve_run_at", maxAttempts: 3 }
  );
};

export default runScheduleNow;
