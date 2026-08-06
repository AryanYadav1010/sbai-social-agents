import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { encryptToken } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
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
    // 1. Exchange the auth code for a short-lived user access token.
    const shortTokenUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
    shortTokenUrl.searchParams.set("client_id", META_APP_ID);
    shortTokenUrl.searchParams.set("redirect_uri", redirectUri);
    shortTokenUrl.searchParams.set("client_secret", META_APP_SECRET);
    shortTokenUrl.searchParams.set("code", code);

    const shortTokenRes = await fetch(shortTokenUrl.toString());
    const shortTokenData = await shortTokenRes.json();
    if (!shortTokenRes.ok) {
      return NextResponse.json({ error: shortTokenData?.error?.message || "Token exchange failed." }, { status: 502 });
    }
    const shortLivedToken: string = shortTokenData.access_token;

    // 2. Exchange for a long-lived token (~60 days), so the connection
    // doesn't need re-authenticating constantly.
    const longTokenUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
    longTokenUrl.searchParams.set("grant_type", "fb_exchange_token");
    longTokenUrl.searchParams.set("client_id", META_APP_ID);
    longTokenUrl.searchParams.set("client_secret", META_APP_SECRET);
    longTokenUrl.searchParams.set("fb_exchange_token", shortLivedToken);

    const longTokenRes = await fetch(longTokenUrl.toString());
    const longTokenData = await longTokenRes.json();
    if (!longTokenRes.ok) {
      return NextResponse.json({ error: longTokenData?.error?.message || "Long-lived token exchange failed." }, { status: 502 });
    }
    const longLivedToken: string = longTokenData.access_token;
    const expiresInSeconds: number | undefined = longTokenData.expires_in;

    // 3. Find the connected Instagram Business Account via the user's Pages.
    const pagesUrl = new URL(`${GRAPH_BASE}/me/accounts`);
    pagesUrl.searchParams.set("fields", "id,name,instagram_business_account");
    pagesUrl.searchParams.set("access_token", longLivedToken);

    const pagesRes = await fetch(pagesUrl.toString());
    const pagesData = await pagesRes.json();
    if (!pagesRes.ok) {
      return NextResponse.json({ error: pagesData?.error?.message || "Could not list Facebook Pages." }, { status: 502 });
    }

    const pageWithInstagram = (pagesData.value || []).find(
      (p: { instagram_business_account?: { id: string } }) => p.instagram_business_account?.id
    );
    if (!pageWithInstagram) {
      return NextResponse.json(
        { error: "No Facebook Page with a linked Instagram Business/Creator account was found for this login." },
        { status: 400 }
      );
    }

    const instagramBusinessAccountId: string = pageWithInstagram.instagram_business_account.id;

    await prisma.socialAccount.create({
      data: {
        platform: "INSTAGRAM",
        externalAccountId: instagramBusinessAccountId,
        displayName: pageWithInstagram.name,
        accessTokenEncrypted: encryptToken(longLivedToken),
        tokenExpiresAt: expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : null,
      },
    });

    await logAudit({
      actorEmail: session.user?.email,
      action: "social_account.connected",
      entity: "SocialAccount",
      entityId: instagramBusinessAccountId,
      metadata: { platform: "INSTAGRAM", pageName: pageWithInstagram.name },
    });

    return NextResponse.redirect(new URL("/", req.url));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error during Meta OAuth callback." },
      { status: 500 }
    );
  }
}
