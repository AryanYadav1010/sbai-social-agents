import "dotenv/config";
import { runOnce } from "graphile-worker";
import { taskList } from "@/src/worker/taskList";
import { closeWorkerDb } from "@/src/worker/queue/db";

// `npm run worker:once` -- drains whatever jobs are currently queued and
// exits, instead of running forever. Useful for local testing and for
// verifying a specific job (e.g. queue a "Run now" from the dashboard,
// then run this to process just that one job under a debugger).
async function once() {
  const connectionString = process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("WORKER_DATABASE_URL (or DATABASE_URL) must be set.");

  await runOnce({ connectionString, taskList });
  console.log("[worker:once] Drained current queue.");
  await closeWorkerDb();
}

once().catch((err) => {
  console.error("[worker:once] failed:", err);
  process.exit(1);
});
