import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { createDraftPost } from "@/lib/orchestrator/createDraft";

export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const posts = await prisma.socialPost.findMany({
    include: { account: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ posts });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const topic = body?.topic;
  const imageUrl = body?.imageUrl;

  if (!topic || typeof topic !== "string") {
    return NextResponse.json({ error: "topic is required." }, { status: 400 });
  }
  if (!imageUrl || typeof imageUrl !== "string") {
    return NextResponse.json({ error: "imageUrl is required (Instagram requires real media, not text-only posts)." }, { status: 400 });
  }

  const account = await prisma.socialAccount.findFirst({ where: { platform: "INSTAGRAM" } });
  if (!account) {
    return NextResponse.json({ error: "No Instagram account connected yet. Connect one via /api/meta/connect first." }, { status: 400 });
  }

  try {
    const result = await createDraftPost({ accountId: account.id, topic, imageUrl });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create draft." },
      { status: 500 }
    );
  }
}
