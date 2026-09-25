import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { enqueueScheduleRunNow } from "@/src/worker/queue/enqueue";
import { logAudit } from "@/lib/audit";

// Manual "Run now" -- enqueues the exact same generateSocialDraft workflow
// the scheduler itself uses (via runScheduleNow), not a separate
// execution path, per spec.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const schedule = await prisma.automationSchedule.findUnique({ where: { id } });
  if (!schedule) return NextResponse.json({ error: "Schedule not found." }, { status: 404 });

  await enqueueScheduleRunNow(id);
  await logAudit({ actorEmail: session.user?.email, action: "automation.run_now_requested", entity: "AutomationSchedule", entityId: id });

  return NextResponse.json({ ok: true, queued: true });
}
