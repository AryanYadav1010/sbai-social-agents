import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireAdminSession } from "@/lib/rbac";

// Lets the dashboard accept a file straight from the admin's device instead
// of requiring a pre-hosted URL or a separate Video Agent production.
// Both Instagram's Content Publishing API and TikTok's Content Posting API
// need a publicly-reachable URL to fetch the media from (Instagram) or we
// fetch it ourselves server-side (TikTok) -- either way the uploaded file
// needs a real public URL, which is exactly what Vercel Blob gives back
// immediately. Once we have that URL, everything downstream (compliance,
// publish) is identical to the existing "Media URL" path -- this route
// only turns a file into a URL, nothing else.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100MB -- comfortably covers short vertical social videos

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `File is ${(file.size / 1024 / 1024).toFixed(1)}MB, exceeds the 100MB limit.` }, { status: 400 });
  }

  try {
    const blob = await put(`uploads/${Date.now()}-${file.name}`, file, {
      access: "public",
      addRandomSuffix: true,
    });
    const mediaType: "IMAGE" | "VIDEO" = file.type.startsWith("video/") ? "VIDEO" : "IMAGE";
    return NextResponse.json({ url: blob.url, mediaType });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed." },
      { status: 500 }
    );
  }
}
