import "dotenv/config";
import { workerPrisma, closeWorkerDb } from "@/src/worker/queue/db";

// `npm run worker:check` -- verifies configuration and database
// connectivity WITHOUT generating content, submitting a video, or
// publishing anything. A safe smoke test to run after install/upgrade or
// when troubleshooting, per spec "Health commands".
async function check() {
  const problems: string[] = [];

  const required = ["DATABASE_URL", "ANTHROPIC_API_KEY", "TOKEN_ENCRYPTION_KEY"];
  for (const key of required) {
    if (!process.env[key]) problems.push(`Missing required env var: ${key}`);
  }
  if (!process.env.WORKER_DATABASE_URL) {
    console.warn("[worker:check] WARN: WORKER_DATABASE_URL not set -- falling back to DATABASE_URL. This works, but if that's a PgBouncer/pooled Neon URL, LISTEN/NOTIFY will not behave correctly under sustained use. See docs/always-on-worker.md.");
  }

  try {
    const accountCount = await workerPrisma.socialAccount.count();
    console.log(`[worker:check] Database reachable via ${process.env.WORKER_DATABASE_URL ? "WORKER_DATABASE_URL" : "DATABASE_URL"} -- ${accountCount} connected social account(s).`);
  } catch (err) {
    problems.push(`Database connection failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  if (problems.length > 0) {
    console.error("[worker:check] FAILED:");
    for (const p of problems) console.error(`  - ${p}`);
    await closeWorkerDb();
    process.exit(1);
  }

  console.log("[worker:check] OK -- configuration and database connectivity look good.");
  await closeWorkerDb();
  process.exit(0);
}

check();
