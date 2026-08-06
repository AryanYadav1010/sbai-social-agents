import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { publishApprovedPost } from "@/lib/orchestrator/publish";
import { logAudit } from "@/lib/audit";

// Mode 1: this is the only path anything can reach PUBLISHED through --
// requires an authenticated admin session and an explicit request. No code
// path auto-approves.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  if (post.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: `Post is ${post.status}, not PENDING_APPROVAL.` }, { status: 400 });
  }

  await prisma.socialPost.update({ where: { id }, data: { status: "APPROVED" } });
  await logAudit({
    actorEmail: session.user?.email,
    action: "social_post.approved",
    entity: "SocialPost",
    entityId: id,
  });

  const result = await publishApprovedPost(id);
  return NextResponse.json(result);
}
