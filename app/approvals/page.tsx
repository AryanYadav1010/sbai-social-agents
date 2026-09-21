import Link from "next/link";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import ApprovalsClient from "@/components/ApprovalsClient";
import BusinessProfileEditor from "@/components/BusinessProfileEditor";
import type { AudienceProfile } from "@/lib/agents/audienceAgent";

export default async function ApprovalsPage() {
  const session = await requireAdminSession();
  if (!session) {
    return (
      <main style={{ padding: 40 }}>
        <p>Unauthorized. <Link href="/api/auth/signin">Sign in</Link></p>
      </main>
    );
  }

  const posts = await prisma.socialPost.findMany({
    include: {
      account: true,
      performanceSnapshots: { orderBy: { fetchedAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const account = await prisma.socialAccount.findFirst({ where: { platform: "INSTAGRAM" } });
  const hasAccount = Boolean(account);

  return (
    <main style={{ padding: 40, maxWidth: 720, margin: "0 auto" }}>
      <h1>Approvals</h1>
      <p style={{ color: "#666" }}>
        Mode 1: nothing publishes to Instagram without an explicit approval here.
      </p>
      <BusinessProfileEditor initialProfile={(account?.audienceProfile as AudienceProfile | null) ?? null} />
      <ApprovalsClient
        initialPosts={JSON.parse(JSON.stringify(posts))}
        hasAccount={hasAccount}
      />
    </main>
  );
}
