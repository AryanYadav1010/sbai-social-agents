import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

// The pre-approved media pool autonomous Video-Agent-using schedules draw
// from (see src/worker/tasks/generateVideo.ts and generateSocialDraft.ts).
// Uploading here is a human, explicit action -- the worker never adds to
// this pool itself, only reads from it, per the "never invent/scrape
// media" requirement.
export async function GET(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId = req.nextUrl.searchParams.get("accountId");
  const assets = await prisma.mediaAsset.findMany({
    where: accountId ? { accountId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ assets });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  const accountId = formData?.get("accountId");
  const label = formData?.get("label");
  if (!file || !(file instanceof File)) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  if (!accountId || typeof accountId !== "string") return NextResponse.json({ error: "accountId is required." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `File is ${(file.size / 1024 / 1024).toFixed(1)}MB, exceeds the 100MB limit.` }, { status: 400 });
  }

  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  try {
    const blob = await put(`media-assets/${Date.now()}-${file.name}`, file, { access: "public", addRandomSuffix: true });
    const kind = file.type.startsWith("video/") ? "video" : "image";
    const asset = await prisma.mediaAsset.create({
      data: { accountId, url: blob.url, kind, label: typeof label === "string" && label ? label : null },
    });
    await logAudit({ actorEmail: session.user?.email, action: "media_asset.uploaded", entity: "MediaAsset", entityId: asset.id, metadata: { accountId, kind } });
    return NextResponse.json({ asset });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed." }, { status: 500 });
  }
}
