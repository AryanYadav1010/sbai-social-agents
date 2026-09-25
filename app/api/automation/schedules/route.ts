import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { computeNextRunAt } from "@/src/worker/queue/schedule";

export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const schedules = await prisma.automationSchedule.findMany({
    include: { account: true, runs: { orderBy: { startedAt: "desc" }, take: 10 } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ schedules });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const accountId = body?.accountId;
  if (!accountId || typeof accountId !== "string") {
    return NextResponse.json({ error: "accountId is required." }, { status: 400 });
  }
  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const timezone = typeof body?.timezone === "string" && body.timezone ? body.timezone : "Europe/London";
  const postsPerDay = Number.isInteger(body?.postsPerDay) ? body.postsPerDay : 1;
  const allowedDays = Array.isArray(body?.allowedDays) ? body.allowedDays : [0, 1, 2, 3, 4, 5, 6];
  const postingTimes = Array.isArray(body?.postingTimes) && body.postingTimes.length ? body.postingTimes : ["12:00"];
  const contentPillars = Array.isArray(body?.contentPillars) ? body.contentPillars : [];

  const nextRunAt = computeNextRunAt(new Date(), { timezone, allowedDays, postingTimes });

  const schedule = await prisma.automationSchedule.create({
    data: {
      accountId,
      enabled: Boolean(body?.enabled),
      timezone,
      postsPerDay,
      allowedDays,
      postingTimes,
      contentPillars,
      campaignBrief: typeof body?.campaignBrief === "string" ? body.campaignBrief : null,
      defaultInstructions: typeof body?.defaultInstructions === "string" ? body.defaultInstructions : null,
      useVideoAgent: Boolean(body?.useVideoAgent),
      requireApproval: body?.requireApproval !== false, // default true -- opt OUT, never opt in by omission
      nextRunAt,
    },
  });

  await logAudit({
    actorEmail: session.user?.email,
    action: "automation.schedule_created",
    entity: "AutomationSchedule",
    entityId: schedule.id,
    metadata: { accountId, enabled: schedule.enabled },
  });

  return NextResponse.json({ schedule });
}
