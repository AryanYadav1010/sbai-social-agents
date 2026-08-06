import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import Link from "next/link";

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return (
      <main style={{ padding: 40, maxWidth: 480, margin: "0 auto" }}>
        <h1>SB AI Systems — Social Agents</h1>
        <p>Sign in with an admin Google account to continue.</p>
        <a href="/api/auth/signin">Sign in</a>
      </main>
    );
  }

  const isAdmin = await requireAdminSession();
  if (!isAdmin) {
    return (
      <main style={{ padding: 40, maxWidth: 480, margin: "0 auto" }}>
        <h1>Access denied</h1>
        <p>Signed in as {session.user?.email}, which is not on the admin list.</p>
      </main>
    );
  }

  const account = await prisma.socialAccount.findFirst({ where: { platform: "INSTAGRAM" } });

  return (
    <main style={{ padding: 40, maxWidth: 480, margin: "0 auto" }}>
      <h1>SB AI Systems — Social Agents</h1>
      <p>Phase 1: Orchestrator + Meta Ecosystem Agent (Instagram) + Content Creation + Compliance, Mode 1.</p>

      {account ? (
        <p>
          Connected: <strong>{account.displayName || account.externalAccountId}</strong>
        </p>
      ) : (
        <p>
          No Instagram account connected yet. <a href="/api/meta/connect">Connect Instagram</a>
        </p>
      )}

      <p>
        <Link href="/approvals">Go to Approvals →</Link>
      </p>
    </main>
  );
}
