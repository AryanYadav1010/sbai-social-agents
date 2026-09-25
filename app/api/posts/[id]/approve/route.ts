import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { enqueuePublishJob } from "@/src/worker/queue/enqueue";
import { logAudit } from "@/lib/audit";

// Mode 1: this is the only path anything can reach PUBLISHED through --
// requires an authenticated admin session and an explicit request. No code
// path auto-approves.
//
// Does NOT publish inline anymore: it validates, marks APPROVED, enqueues
// a durable publishApprovedPost job, and returns immediately. The actual
// platform call (which can take up to several minutes -- see TikTok's
// processing poll) now happens in the background worker, so this request
// is never at the mercy of a browser tab staying open or a serverless
// function's execution-time limit. The dashboard picks up the eventual
// PUBLISHED/PUBLISH_FAILED/PUBLISH_AMBIGUOUS status via its own refresh.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  // PUBLISH_FAILED and PUBLISH_AMBIGUOUS are both retryable from here --
  // the post already passed compliance and human approval once. Ambiguous
  // still requires the human to have actually checked the real account
  // first (the dashboard copy makes this explicit); this endpoint doesn't
  // know whether that check happened, it just allows the retry itself.
  if (post.status !== "PENDING_APPROVAL" && post.status !== "PUBLISH_FAILED" && post.status !== "PUBLISH_AMBIGUOUS") {
    return NextResponse.json(
      { error: `Post is ${post.status}, not PENDING_APPROVAL, PUBLISH_FAILED, or PUBLISH_AMBIGUOUS.` },
      { status: 400 }
    );
  }

  await prisma.socialPost.update({ where: { id }, data: { status: "APPROVED" } });
  await logAudit({
    actorEmail: session.user?.email,
    action: "social_post.approved",
    entity: "SocialPost",
    entityId: id,
  });

  await enqueuePublishJob(id);
  await logAudit({
    actorEmail: session.user?.email,
    action: "social_post.publish_queued",
    entity: "SocialPost",
    entityId: id,
  });

  return NextResponse.json({ ok: true, queued: true });
}
