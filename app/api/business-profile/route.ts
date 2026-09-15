import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import type { AudienceProfile } from "@/lib/agents/audienceAgent";

export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.socialAccount.findFirst({ where: { platform: "INSTAGRAM" } });
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

  const account = await prisma.socialAccount.findFirst({ where: { platform: "INSTAGRAM" } });
  if (!account) {
    return NextResponse.json({ error: "No Instagram account connected yet." }, { status: 400 });
  }

  const profile: AudienceProfile = {
    businessSummary,
    targetAudience,
    brandVoice: typeof brandVoice === "string" && brandVoice ? brandVoice : undefined,
    goals: typeof goals === "string" && goals ? goals : undefined,
  };

  await prisma.socialAccount.update({
    where: { id: account.id },
    data: { audienceProfile: JSON.parse(JSON.stringify(profile)) },
  });

  await logAudit({
    actorEmail: session.user?.email,
    action: "business_profile.updated",
    entity: "SocialAccount",
    entityId: account.id,
    metadata: { targetAudience },
  });

  return NextResponse.json({ audienceProfile: profile });
}
