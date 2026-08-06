import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import ApprovalsClient from "@/components/ApprovalsClient";

export default async function ApprovalsPage() {
  const session = await requireAdminSession();
  if (!session) {
    return (
      <main style={{ padding: 40 }}>
        <p>Unauthorized. <a href="/api/auth/signin">Sign in</a></p>
      </main>
    );
  }

  const posts = await prisma.socialPost.findMany({
    include: { account: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const hasAccount = Boolean(await prisma.socialAccount.findFirst({ where: { platform: "INSTAGRAM" } }));

  return (
    <main style={{ padding: 40, maxWidth: 720, margin: "0 auto" }}>
      <h1>Approvals</h1>
      <p style={{ color: "#666" }}>
        Mode 1: nothing publishes to Instagram without an explicit approval here.
      </p>
      <ApprovalsClient
        initialPosts={JSON.parse(JSON.stringify(posts))}
        hasAccount={hasAccount}
      />
    </main>
  );
}
