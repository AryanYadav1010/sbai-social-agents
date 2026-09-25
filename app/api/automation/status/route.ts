import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";

const STALE_AFTER_MS = Number(process.env.WORKER_HEARTBEAT_SECONDS || 30) * 1000 * 3;

// Dashboard's "is automation execution online" read -- deliberately
// returns nothing beyond hostname/status/timestamps (no credentials, no
// filesystem paths), safe for any authenticated admin to see.
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
  const nodes = await prisma.workerNode.findMany({
    orderBy: { lastHeartbeatAt: "desc" },
    take: 10,
  });
  const onlineNodes = nodes.filter((n) => n.status === "ONLINE" && n.lastHeartbeatAt >= staleBefore);

  return NextResponse.json({
    online: onlineNodes.length > 0,
    nodes: nodes.map((n) => ({
      hostname: n.hostname,
      status: n.status === "ONLINE" && n.lastHeartbeatAt < staleBefore ? "STALE" : n.status,
      concurrency: n.concurrency,
      runningJobCount: n.runningJobCount,
      lastHeartbeatAt: n.lastHeartbeatAt,
      startedAt: n.startedAt,
      appVersion: n.appVersion,
    })),
  });
}
