import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// The worker is a standalone long-lived Node process, not a Vercel request
// handler -- it gets its own Prisma client (no hot-reload global-caching
// dance needed, this module is only ever loaded once per process) and its
// own small connection pool, deliberately separate from the app's pooled
// DATABASE_URL. Graphile Worker relies on LISTEN/NOTIFY, which needs a
// real persistent connection -- a PgBouncer transaction-pooling endpoint
// (the usual Neon "-pooler" URL) silently breaks that, so this must be a
// direct connection. See docs/always-on-worker.md.
const WORKER_DATABASE_URL = process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL;

if (!WORKER_DATABASE_URL) {
  throw new Error("WORKER_DATABASE_URL (or DATABASE_URL as a fallback) must be set for the worker process.");
}

export const workerPgPool = new Pool({
  connectionString: WORKER_DATABASE_URL,
  max: Number(process.env.WORKER_DB_POOL_SIZE || 5), // kept small deliberately -- this is a
  // background worker, not a request-serving app; a handful of connections
  // is plenty even at WORKER_CONCURRENCY well above the default.
});

const adapter = new PrismaPg(workerPgPool);
export const workerPrisma = new PrismaClient({ adapter });

export async function closeWorkerDb() {
  await workerPrisma.$disconnect();
  await workerPgPool.end();
}
