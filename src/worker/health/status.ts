import "dotenv/config";
import { workerPrisma, closeWorkerDb } from "@/src/worker/queue/db";

// `npm run worker:status` -- prints which worker nodes the database
// currently knows about, without needing DB GUI access.
async function status() {
  const nodes = await workerPrisma.workerNode.findMany({
    orderBy: { lastHeartbeatAt: "desc" },
    take: 20,
  });

  if (nodes.length === 0) {
    console.log("No worker nodes have ever registered.");
  } else {
    console.log(`${nodes.length} worker node(s) (most recent heartbeat first):\n`);
    for (const n of nodes) {
      const ageSec = Math.round((Date.now() - n.lastHeartbeatAt.getTime()) / 1000);
      console.log(
        `  [${n.status}] ${n.hostname} -- concurrency=${n.concurrency}, running=${n.runningJobCount}, ` +
          `last heartbeat ${ageSec}s ago, started ${n.startedAt.toISOString()}${n.appVersion ? `, commit ${n.appVersion}` : ""}`
      );
    }
  }

  const dueSchedules = await workerPrisma.automationSchedule.count({ where: { enabled: true, nextRunAt: { lte: new Date() } } });
  const enabledSchedules = await workerPrisma.automationSchedule.count({ where: { enabled: true } });
  const pendingApproval = await workerPrisma.socialPost.count({ where: { status: "PENDING_APPROVAL" } });
  console.log(`\n${enabledSchedules} enabled automation schedule(s), ${dueSchedules} currently due.`);
  console.log(`${pendingApproval} post(s) pending approval.`);

  await closeWorkerDb();
}

status();
