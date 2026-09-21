import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;

// video.upload (not video.publish) -- video.upload sends to the user's
// private TikTok inbox as a draft, which needs no TikTok app review.
// video.publish (Direct Post, auto-publish with no manual tap) only
// activates once TikTok has reviewed and approved the app for it.
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
