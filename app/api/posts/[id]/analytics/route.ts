import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";
import { refreshPostAnalytics } from "@/lib/agents/analyticsAgent";

// Analytics Agent trigger -- read-only, admin-gated, on-demand only (no
// cron/queue infra in this project). Never touches SocialPost.status.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const result = await refreshPostAnalytics(id);
  return NextResponse.json(result);
}
