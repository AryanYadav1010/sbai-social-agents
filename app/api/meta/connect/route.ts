import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";

const GRAPH_API_VERSION = "v21.0";
const META_APP_ID = process.env.META_APP_ID;

// Meta Login for Business: redirects the admin to Meta's OAuth dialog.
// Requires the Instagram account to be a Business/Creator account with a
// linked Facebook Page, and (for now, pre-App-Review) added as a Tester on
// the Meta app -- see the plan's "external prerequisites" note.
export async function GET(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!META_APP_ID) {
    return NextResponse.json({ error: "META_APP_ID is not configured." }, { status: 503 });
  }

  const redirectUri = new URL("/api/meta/callback", req.url).toString();
  const scopes = ["instagram_business_basic", "instagram_business_content_publish", "pages_show_list"].join(",");

  const authUrl = new URL(`https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`);
  authUrl.searchParams.set("client_id", META_APP_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("response_type", "code");

  return NextResponse.redirect(authUrl.toString());
}
