import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import Link from "next/link";

function PlatformCard({
  name,
  connected,
  displayName,
  connectHref,
  accent,
}: {
  name: string;
  connected: boolean;
  displayName?: string | null;
  connectHref: string;
  accent: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold text-white ${accent}`}>
          {name[0]}
        </span>
        <div>
          <div className="font-medium text-slate-900">{name}</div>
          {connected ? (
            <div className="text-sm text-slate-500">{displayName}</div>
          ) : (
            <div className="text-sm text-slate-400">Not connected</div>
          )}
        </div>
      </div>
      {connected ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Connected
        </span>
      ) : (
        <a
          href={connectHref}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
        >
          Connect
        </a>
      )}
    </div>
  );
}

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">SB AI Systems — Social Agents</h1>
        <p className="text-slate-500">Sign in with an admin Google account to continue.</p>
        <Link
          href="/api/auth/signin"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Sign in
        </Link>
      </main>
    );
  }

  const isAdmin = await requireAdminSession();
  if (!isAdmin) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center gap-2 px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">Access denied</h1>
        <p className="text-slate-500">
          Signed in as <span className="font-medium text-slate-700">{session.user?.email}</span>, which is not on the
          admin list.
        </p>
      </main>
    );
  }

  const [instagram, tiktok] = await Promise.all([
    prisma.socialAccount.findFirst({ where: { platform: "INSTAGRAM" } }),
    prisma.socialAccount.findFirst({ where: { platform: "TIKTOK" } }),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-slate-900">Connected accounts</h1>
      <p className="mt-1 text-sm text-slate-500">
        Orchestrator + Meta/TikTok Ecosystem Agents + Content Creation + Compliance, Mode 1 — nothing publishes without
        human approval.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        <PlatformCard
          name="Instagram"
          connected={Boolean(instagram)}
          displayName={instagram?.displayName || instagram?.externalAccountId}
          connectHref="/api/meta/connect"
          accent="bg-gradient-to-br from-fuchsia-500 to-amber-400"
        />
        <PlatformCard
          name="TikTok"
          connected={Boolean(tiktok)}
          displayName={tiktok?.displayName || tiktok?.externalAccountId}
          connectHref="/api/tiktok/connect"
          accent="bg-slate-900"
        />
      </div>

      <Link
        href="/approvals"
        className="mt-8 inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Go to Approvals →
      </Link>
    </main>
  );
}
