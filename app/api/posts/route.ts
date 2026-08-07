import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { createDraftPost } from "@/lib/orchestrator/createDraft";
import { resolveVideoAgentMedia } from "@/lib/agents/videoAgent";

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
  const mediaUrl = body?.mediaUrl;
  const videoAgentProductionId = body?.videoAgentProductionId;

  if (!topic || typeof topic !== "string") {
    return NextResponse.json({ error: "topic is required." }, { status: 400 });
  }
  if (!mediaUrl && !videoAgentProductionId) {
    return NextResponse.json(
      { error: "mediaUrl or videoAgentProductionId is required (Instagram requires real media, not text-only posts)." },
      { status: 400 }
    );
  }

  const account = await prisma.socialAccount.findFirst({ where: { platform: "INSTAGRAM" } });
  if (!account) {
    return NextResponse.json({ error: "No Instagram account connected yet. Connect one via /api/meta/connect first." }, { status: 400 });
  }

  let resolvedMediaType: "IMAGE" | "VIDEO" = "IMAGE";
  let resolvedMediaUrl: string;

  if (videoAgentProductionId && typeof videoAgentProductionId === "string") {
    const resolved = await resolveVideoAgentMedia(videoAgentProductionId);
    if (!resolved.ok || !resolved.mediaUrl) {
      return NextResponse.json({ error: resolved.error || "Could not resolve Video Agent production." }, { status: 400 });
    }
    resolvedMediaType = "VIDEO";
    resolvedMediaUrl = resolved.mediaUrl;
  } else if (typeof mediaUrl === "string" && mediaUrl) {
    resolvedMediaUrl = mediaUrl;
  } else {
    return NextResponse.json({ error: "mediaUrl must be a string." }, { status: 400 });
  }

  try {
    const result = await createDraftPost({
      accountId: account.id,
      topic,
      mediaType: resolvedMediaType,
      mediaUrl: resolvedMediaUrl,
      videoAgentProductionId: typeof videoAgentProductionId === "string" ? videoAgentProductionId : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create draft." },
      { status: 500 }
    );
  }
}
