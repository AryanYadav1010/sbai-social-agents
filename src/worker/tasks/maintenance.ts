import type { Task } from "graphile-worker";
import { workerPrisma } from "@/src/worker/queue/db";

// Small periodic janitor (cron, see src/worker/index.ts). Currently just
// marks worker nodes whose heartbeat has gone stale as OFFLINE, so the
// dashboard's "is automation execution online" indicator (spec section
// "Worker identity and heartbeat") reflects reality even if a node died
// without a clean shutdown (killed process, power loss -- SIGTERM/SIGINT
// handling covers the graceful case, this covers the non-graceful one).
const STALE_AFTER_MS = Number(process.env.WORKER_HEARTBEAT_SECONDS || 30) * 1000 * 3; // 3 missed heartbeats

const maintenance: Task = async (_payload, helpers) => {
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
  const result = await workerPrisma.workerNode.updateMany({
    where: { status: "ONLINE", lastHeartbeatAt: { lt: staleBefore } },
    data: { status: "OFFLINE" },
  });
  if (result.count > 0) {
    helpers.logger.info(`Marked ${result.count} worker node(s) OFFLINE (stale heartbeat).`);
  }
};

export default maintenance;
