import Link from "next/link";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import AutomationClient from "@/components/AutomationClient";

const STALE_AFTER_MS = Number(process.env.WORKER_HEARTBEAT_SECONDS || 30) * 1000 * 3;

export default async function AutomationPage() {
  const session = await requireAdminSession();
  if (!session) {
    return (
      <main className="mx-auto max-w-md px-6 py-24 text-center">
        <p className="text-slate-500">
          Unauthorized.{" "}
          <Link href="/api/auth/signin" className="font-medium text-indigo-600 hover:text-indigo-500">
            Sign in
          </Link>
        </p>
      </main>
    );
  }

  const [accounts, schedules, workerNodes, mediaAssets] = await Promise.all([
    prisma.socialAccount.findMany({ orderBy: { platform: "asc" } }),
    prisma.automationSchedule.findMany({
      include: { runs: { orderBy: { startedAt: "desc" }, take: 5 } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.workerNode.findMany({ orderBy: { lastHeartbeatAt: "desc" }, take: 10 }),
    prisma.mediaAsset.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-slate-900">Automation</h1>
      <p className="mt-1 text-sm text-slate-500">
        Configure always-on content schedules. The Content Creation and Compliance agents are the same ones the
        Approvals page uses -- automation only decides <em>when</em> and <em>what topic</em>, never the final copy,
        and never publishes without approval unless you explicitly enable that below.
      </p>

      <AutomationClient
        accounts={JSON.parse(JSON.stringify(accounts))}
        initialSchedules={JSON.parse(JSON.stringify(schedules))}
        workerNodes={JSON.parse(JSON.stringify(workerNodes))}
        mediaAssets={JSON.parse(JSON.stringify(mediaAssets))}
        staleAfterMs={STALE_AFTER_MS}
      />
    </main>
  );
}
