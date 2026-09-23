import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import type { AudienceProfile } from "@/lib/agents/audienceAgent";

// The Audience Agent profile describes the business, not any one platform
// -- it's shared across every connected account (Instagram, TikTok, ...),
// not scoped to whichever one happened to connect first. The PUT handler
// keeps every connected account's copy in sync, so reading from any one of
// them is equivalent -- no platform filter needed.
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.socialAccount.findFirst();
  return NextResponse.json({ audienceProfile: (account?.audienceProfile as AudienceProfile | null) ?? null });
}

export async function PUT(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const businessSummary = body?.businessSummary;
  const targetAudience = body?.targetAudience;
  const brandVoice = body?.brandVoice;
  const goals = body?.goals;

  if (!businessSummary || typeof businessSummary !== "string") {
    return NextResponse.json({ error: "businessSummary is required." }, { status: 400 });
  }
  if (!targetAudience || typeof targetAudience !== "string") {
    return NextResponse.json({ error: "targetAudience is required." }, { status: 400 });
  }

  const accounts = await prisma.socialAccount.findMany();
  if (accounts.length === 0) {
    return NextResponse.json({ error: "No account connected yet -- connect Instagram or TikTok first." }, { status: 400 });
  }

  const profile: AudienceProfile = {
    businessSummary,
    targetAudience,
    brandVoice: typeof brandVoice === "string" && brandVoice ? brandVoice : undefined,
    goals: typeof goals === "string" && goals ? goals : undefined,
  };

  // Written onto every connected account, not just one -- this profile
  // describes the business, and every platform's drafts (Instagram,
  // TikTok, ...) read it from their own account row.
  await prisma.socialAccount.updateMany({
    data: { audienceProfile: JSON.parse(JSON.stringify(profile)) },
  });

  await logAudit({
    actorEmail: session.user?.email,
    action: "business_profile.updated",
    entity: "SocialAccount",
    entityId: accounts.map((a) => a.id).join(","),
    metadata: { targetAudience },
  });

  return NextResponse.json({ audienceProfile: profile });
}
