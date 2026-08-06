import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";

const META_APP_ID = process.env.META_APP_ID;

// Instagram API with Instagram Login ("Business Login for Instagram") --
// authenticates directly against instagram.com, no Facebook Page required
// at all. This is the 2024+ replacement for the older Facebook-Page-linked
// flow, and the right fit here since the connected account has no Page.
export async function GET(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!META_APP_ID) {
    return NextResponse.json({ error: "META_APP_ID is not configured." }, { status: 503 });
  }

  const redirectUri = new URL("/api/meta/callback", req.url).toString();
  const scopes = ["instagram_business_basic", "instagram_business_content_publish"].join(",");

  const authUrl = new URL("https://www.instagram.com/oauth/authorize");
  authUrl.searchParams.set("client_id", META_APP_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("response_type", "code");

  return NextResponse.redirect(authUrl.toString());
}
