import "dotenv/config";
import { run, runMigrations, parseCronItems, type CronItem } from "graphile-worker";
import { taskList } from "@/src/worker/taskList";
import { startHeartbeat } from "@/src/worker/health/heartbeat";
import { closeWorkerDb } from "@/src/worker/queue/db";

// Always-on worker entrypoint (spec: "Required architecture"). Not an
// infinite `while(true)` poller -- graphile-worker itself uses
// LISTEN/NOTIFY plus a bounded poll interval, so the process is idle
// (zero Anthropic/platform calls) whenever there is genuinely no due work,
// exactly the cost-protection property required.
//
// Scheduled work is expressed as crontab-style entries below rather than
// as one OS/DB cron row per customer -- schedulerTick itself is the one
// thing that runs on a timer; it's schedulerTick's job to find and enqueue
// whichever individual customer schedules are actually due.
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 4);

async function main() {
  const connectionString = process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("WORKER_DATABASE_URL (or DATABASE_URL) must be set.");
  }

  console.log("[worker] starting -- running graphile-worker schema migrations...");
  await runMigrations({ connectionString });
  console.log("[worker] schema ready.");

  const heartbeat = await startHeartbeat({ concurrency: CONCURRENCY });
  console.log(`[worker] registered as node ${heartbeat.workerNodeId}, concurrency=${CONCURRENCY}`);

  // parseCronItems takes structured CronItem objects, not raw crontab
  // string lines (that's parseCrontab, a different function) -- explicit
  // objects also let `identifier` be set directly rather than relying on
  // crontab-line parsing to derive one correctly.
  const cronItemSpecs: CronItem[] = [
    { task: "schedulerTick", match: "* * * * *", identifier: "schedulerTick" },
    { task: "maintenance", match: "* * * * *", identifier: "maintenance" },
    { task: "refreshPerformance", match: "0 * * * *", identifier: "refreshPerformance" },
  ];
  const cronItems = parseCronItems(cronItemSpecs);

  const runner = await run({
    connectionString,
    concurrency: CONCURRENCY,
    taskList,
    parsedCronItems: cronItems,
    noHandleSignals: true, // we install our own combined handler below so
    // heartbeat cleanup and the queue's own graceful drain happen together,
    // not racing each other on process exit.
  });
  console.log("[worker] ready -- listening for jobs.");

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] received ${signal}, shutting down gracefully (in-flight jobs get a chance to finish)...`);
    try {
      await runner.stop();
    } catch (err) {
      console.error("[worker] error stopping runner:", err);
    }
    await heartbeat.stop();
    await closeWorkerDb();
    console.log("[worker] shutdown complete.");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await runner.promise;
}

main().catch((err) => {
  console.error("[worker] fatal error during startup:", err);
  process.exit(1);
});
