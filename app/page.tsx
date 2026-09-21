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
        <Link href="/api/auth/signin">Sign in</Link>
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

  const [instagram, tiktok] = await Promise.all([
    prisma.socialAccount.findFirst({ where: { platform: "INSTAGRAM" } }),
    prisma.socialAccount.findFirst({ where: { platform: "TIKTOK" } }),
  ]);

  return (
    <main style={{ padding: 40, maxWidth: 480, margin: "0 auto" }}>
      <h1>SB AI Systems — Social Agents</h1>
      <p>Orchestrator + Meta/TikTok Ecosystem Agents + Content Creation + Compliance, Mode 1.</p>

      {instagram ? (
        <p>
          Instagram connected: <strong>{instagram.displayName || instagram.externalAccountId}</strong>
        </p>
      ) : (
        <p>
          No Instagram account connected yet. <a href="/api/meta/connect">Connect Instagram</a>
        </p>
      )}

      {tiktok ? (
        <p>
          TikTok connected: <strong>{tiktok.displayName || tiktok.externalAccountId}</strong>
        </p>
      ) : (
        <p>
          No TikTok account connected yet. <a href="/api/tiktok/connect">Connect TikTok</a>
        </p>
      )}

      <p>
        <Link href="/approvals">Go to Approvals →</Link>
      </p>
    </main>
  );
}
