import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;

// video.upload (not video.publish) -- sends to the user's private TikTok
// inbox as a draft, needs no TikTok app review. Reverted from Direct Post
// (video.publish) 2026-09-23 -- that pathway itself rejected posts with a
// content-guidelines error even for an already-proven-good video; see
// tiktokEcosystem.ts for the full story.
export async function GET(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!TIKTOK_CLIENT_KEY) {
    return NextResponse.json({ error: "TIKTOK_CLIENT_KEY is not configured." }, { status: 503 });
  }

  const redirectUri = new URL("/api/tiktok/callback", req.url).toString();
  const scopes = ["user.info.basic", "video.upload"].join(",");

  const authUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
  authUrl.searchParams.set("client_key", TIKTOK_CLIENT_KEY);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("response_type", "code");

  return NextResponse.redirect(authUrl.toString());
}
