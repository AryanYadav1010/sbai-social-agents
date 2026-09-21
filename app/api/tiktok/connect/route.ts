import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;

// video.publish (not video.upload) -- video.upload only sends to the
// user's private inbox as a draft, video.publish is what Direct Post
// (actually going live) requires.
export async function GET(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!TIKTOK_CLIENT_KEY) {
    return NextResponse.json({ error: "TIKTOK_CLIENT_KEY is not configured." }, { status: 503 });
  }

  const redirectUri = new URL("/api/tiktok/callback", req.url).toString();
  const scopes = ["user.info.basic", "video.publish"].join(",");

  const authUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
  authUrl.searchParams.set("client_key", TIKTOK_CLIENT_KEY);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("response_type", "code");

  return NextResponse.redirect(authUrl.toString());
}
