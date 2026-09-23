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

  const posts = await prisma.socialPost.findMany({
    include: {
      account: true,
      performanceSnapshots: { orderBy: { fetchedAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const account = await prisma.socialAccount.findFirst({ where: { platform: "INSTAGRAM" } });
  const tiktokAccount = await prisma.socialAccount.findFirst({ where: { platform: "TIKTOK" } });
  const hasAccounts = { INSTAGRAM: Boolean(account), TIKTOK: Boolean(tiktokAccount) };
  // The Audience Agent profile is shared across every connected platform
  // (one business, not one per platform) -- either connected account's copy
  // works since the PUT handler keeps them in sync.
  const profileSource = account ?? tiktokAccount;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-slate-900">Approvals</h1>
      <p className="mt-1 text-sm text-slate-500">
        Mode 1: nothing publishes to Instagram or TikTok without an explicit approval here.
      </p>
      <div className="mt-6">
        <BusinessProfileEditor initialProfile={(profileSource?.audienceProfile as AudienceProfile | null) ?? null} />
      </div>
      <ApprovalsClient
        initialPosts={JSON.parse(JSON.stringify(posts))}
        hasAccounts={hasAccounts}
      />
    </main>
  );
}
