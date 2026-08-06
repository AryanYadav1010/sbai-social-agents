import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { encryptToken } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";

const GRAPH_API_VERSION = "v21.0";
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;

export async function GET(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!META_APP_ID || !META_APP_SECRET) {
    return NextResponse.json({ error: "META_APP_ID/META_APP_SECRET are not configured." }, { status: 503 });
  }

  const code = req.nextUrl.searchParams.get("code");
  const oauthError = req.nextUrl.searchParams.get("error_description");
  if (oauthError) {
    return NextResponse.json({ error: oauthError }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: "Missing OAuth code." }, { status: 400 });
  }

  const redirectUri = new URL("/api/meta/callback", req.url).toString();

  try {
    // 1. Exchange the auth code for a short-lived token. Instagram API with
    // Instagram Login returns the IG-scoped user_id directly here -- no
    // Facebook Page lookup needed at all.
    const shortTokenBody = new URLSearchParams({
      client_id: META_APP_ID,
      client_secret: META_APP_SECRET,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    });

    const shortTokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: shortTokenBody,
    });
    const shortTokenData = await shortTokenRes.json();
    if (!shortTokenRes.ok) {
      return NextResponse.json({ error: shortTokenData?.error_message || "Token exchange failed." }, { status: 502 });
    }
    const shortLivedToken: string = shortTokenData.access_token;
    const igUserId: string = String(shortTokenData.user_id);

    // 2. Exchange for a long-lived token (~60 days), so the connection
    // doesn't need re-authenticating constantly.
    const longTokenUrl = new URL("https://graph.instagram.com/access_token");
    longTokenUrl.searchParams.set("grant_type", "ig_exchange_token");
    longTokenUrl.searchParams.set("client_secret", META_APP_SECRET);
    longTokenUrl.searchParams.set("access_token", shortLivedToken);

    const longTokenRes = await fetch(longTokenUrl.toString());
    const longTokenData = await longTokenRes.json();
    if (!longTokenRes.ok) {
      return NextResponse.json({ error: longTokenData?.error?.message || "Long-lived token exchange failed." }, { status: 502 });
    }
    const longLivedToken: string = longTokenData.access_token;
    const expiresInSeconds: number | undefined = longTokenData.expires_in;

    // 3. Fetch the account's username for a friendly display name.
    const meUrl = new URL(`https://graph.instagram.com/${GRAPH_API_VERSION}/me`);
    meUrl.searchParams.set("fields", "user_id,username");
    meUrl.searchParams.set("access_token", longLivedToken);

    const meRes = await fetch(meUrl.toString());
    const meData = await meRes.json();
    const displayName: string = meRes.ok && meData.username ? meData.username : igUserId;

    await prisma.socialAccount.create({
      data: {
        platform: "INSTAGRAM",
        externalAccountId: igUserId,
        displayName,
        accessTokenEncrypted: encryptToken(longLivedToken),
        tokenExpiresAt: expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : null,
      },
    });

    await logAudit({
      actorEmail: session.user?.email,
      action: "social_account.connected",
      entity: "SocialAccount",
      entityId: igUserId,
      metadata: { platform: "INSTAGRAM", username: displayName },
    });

    return NextResponse.redirect(new URL("/", req.url));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error during Meta OAuth callback." },
      { status: 500 }
    );
  }
}
