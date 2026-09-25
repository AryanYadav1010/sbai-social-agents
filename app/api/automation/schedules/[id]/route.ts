import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { computeNextRunAt } from "@/src/worker/queue/schedule";

const ENABLE_AUTONOMOUS_PUBLISH = process.env.ENABLE_AUTONOMOUS_PUBLISH === "true";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.automationSchedule.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Schedule not found." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  // requireApproval=false only ever has an effect if the server-side flag
  // is also on -- a per-account opt-in can never override the global
  // default-off gate (spec: "must be behind BOTH" gates). We still record
  // what the admin asked for, so flipping the server flag later doesn't
  // silently auto-publish for every account that happened to have this set.
  if (body.requireApproval === false && !ENABLE_AUTONOMOUS_PUBLISH) {
    // allowed to save, but logged clearly so it's not a silent surprise later
    await logAudit({
      actorEmail: session.user?.email,
      action: "automation.autonomous_publish_requested_but_disabled",
      entity: "AutomationSchedule",
      entityId: id,
      metadata: { note: "ENABLE_AUTONOMOUS_PUBLISH server flag is off -- this account will still require human approval regardless." },
    });
  }

  const timezone = typeof body.timezone === "string" && body.timezone ? body.timezone : existing.timezone;
  const allowedDays = Array.isArray(body.allowedDays) ? body.allowedDays : existing.allowedDays;
  const postingTimes = Array.isArray(body.postingTimes) && body.postingTimes.length ? body.postingTimes : existing.postingTimes;

  const enabledChanged = typeof body.enabled === "boolean" && body.enabled !== existing.enabled;
  const scheduleShapeChanged = timezone !== existing.timezone || JSON.stringify(allowedDays) !== JSON.stringify(existing.allowedDays) || JSON.stringify(postingTimes) !== JSON.stringify(existing.postingTimes);

  const nextRunAt =
    enabledChanged && body.enabled
      ? computeNextRunAt(new Date(), { timezone, allowedDays, postingTimes })
      : scheduleShapeChanged
      ? computeNextRunAt(new Date(), { timezone, allowedDays, postingTimes })
      : existing.nextRunAt;

  const schedule = await prisma.automationSchedule.update({
    where: { id },
    data: {
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      timezone,
      postsPerDay: Number.isInteger(body.postsPerDay) ? body.postsPerDay : undefined,
      allowedDays,
      postingTimes,
      contentPillars: Array.isArray(body.contentPillars) ? body.contentPillars : undefined,
      campaignBrief: typeof body.campaignBrief === "string" ? body.campaignBrief : undefined,
      defaultInstructions: typeof body.defaultInstructions === "string" ? body.defaultInstructions : undefined,
      useVideoAgent: typeof body.useVideoAgent === "boolean" ? body.useVideoAgent : undefined,
      requireApproval: typeof body.requireApproval === "boolean" ? body.requireApproval : undefined,
      nextRunAt,
    },
  });

  await logAudit({
    actorEmail: session.user?.email,
    action: "automation.schedule_updated",
    entity: "AutomationSchedule",
    entityId: id,
    metadata: { enabled: schedule.enabled },
  });

  return NextResponse.json({ schedule });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await prisma.automationSchedule.update({ where: { id }, data: { enabled: false, nextRunAt: null } });
  await logAudit({ actorEmail: session.user?.email, action: "automation.schedule_disabled", entity: "AutomationSchedule", entityId: id });
  return NextResponse.json({ ok: true });
}
