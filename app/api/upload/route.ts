import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireAdminSession } from "@/lib/rbac";

// Browser-direct upload: the dashboard sends the file straight to Vercel
// Blob, and this route only issues a short-lived, admin-gated upload token.
// Streaming the file through this function instead hits Vercel's ~4.5MB
// request-body cap, which nearly every phone video exceeds. The resulting
// public URL is what TikTok/Instagram fetch the media from.
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["video/mp4", "video/quicktime", "video/webm", "image/jpeg", "image/png", "image/webp"],
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        addRandomSuffix: true,
      }),
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed." }, { status: 400 });
  }
}
