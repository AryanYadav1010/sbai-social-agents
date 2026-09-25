import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await prisma.mediaAsset.delete({ where: { id } }).catch(() => null);
  await logAudit({ actorEmail: session.user?.email, action: "media_asset.deleted", entity: "MediaAsset", entityId: id });
  return NextResponse.json({ ok: true });
}
