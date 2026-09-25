import os from "node:os";
import { workerPrisma } from "@/src/worker/queue/db";

// Registration/heartbeat for this machine (spec section "Worker identity
// and heartbeat"). Deliberately minimal about what it exposes: hostname,
// OS platform, concurrency, and (if available) the deployed commit SHA --
// no usernames, no filesystem paths, no secrets.
export interface HeartbeatHandle {
  workerNodeId: string;
  stop: () => Promise<void>;
}

export async function startHeartbeat(opts: { concurrency: number }): Promise<HeartbeatHandle> {
  const hostname = process.env.WORKER_NODE_NAME || os.hostname();
  const appVersion = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || undefined;
  const intervalMs = Number(process.env.WORKER_HEARTBEAT_SECONDS || 30) * 1000;

  const node = await workerPrisma.workerNode.create({
    data: {
      hostname,
      appVersion: appVersion?.slice(0, 12),
      os: `${os.platform()} ${os.release()}`,
      concurrency: opts.concurrency,
      status: "ONLINE",
    },
  });

  const timer = setInterval(async () => {
    try {
      await workerPrisma.workerNode.update({
        where: { id: node.id },
        data: { lastHeartbeatAt: new Date(), status: "ONLINE" },
      });
    } catch {
      // A single missed heartbeat write (e.g. transient network blip) is
      // fine -- maintenance.ts's staleness check has a 3-beat grace
      // window specifically so one failed write doesn't flip the
      // dashboard to "offline" for a healthy node.
    }
  }, intervalMs);
  // Don't let this interval keep the process alive on its own during
  // shutdown -- graceful shutdown is driven explicitly via stop().
  timer.unref();

  const stop = async () => {
    clearInterval(timer);
    try {
      await workerPrisma.workerNode.update({
        where: { id: node.id },
        data: { status: "OFFLINE", lastHeartbeatAt: new Date() },
      });
    } catch {
      // best-effort -- if the DB is unreachable at shutdown there's
      // nothing more useful to do here.
    }
  };

  return { workerNodeId: node.id, stop };
}
