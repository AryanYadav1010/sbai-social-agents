import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { encryptToken } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { exchangeTikTokCode, getTikTokDisplayName } from "@/lib/agents/tiktokEcosystem";

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;

export async function GET(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
    return NextResponse.json({ error: "TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET are not configured." }, { status: 503 });
  }

  const code = req.nextUrl.searchParams.get("code");
  const oauthError = req.nextUrl.searchParams.get("error_description");
  if (oauthError) {
    return NextResponse.json({ error: oauthError }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: "Missing OAuth code." }, { status: 400 });
  }

  const redirectUri = new URL("/api/tiktok/callback", req.url).toString();

  const token = await exchangeTikTokCode(code, redirectUri, TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET);
  if (!token.ok || !token.accessToken || !token.openId) {
    return NextResponse.json({ error: token.error || "TikTok token exchange failed." }, { status: 502 });
  }

  const displayName = (await getTikTokDisplayName(token.accessToken)) ?? token.openId;

  // Update in place if a TikTok account row already exists -- reconnecting
  // (e.g. to grant a newly-added scope like video.publish) must replace the
  // old token, not sit next to it as a second row that a plain findFirst()
  // might still return instead of the fresh one. Not a delete+recreate:
  // existing SocialPosts hold a foreign key to this row's id, so deleting
  // it would break their history.
  const existing = await prisma.socialAccount.findFirst({ where: { platform: "TIKTOK" } });
  const accountData = {
    externalAccountId: token.openId,
    displayName,
    accessTokenEncrypted: encryptToken(token.accessToken),
    tokenExpiresAt: token.expiresInSeconds ? new Date(Date.now() + token.expiresInSeconds * 1000) : null,
    // Access tokens last 24h; the refresh token (about a year) is what lets
    // publishing renew them automatically -- see lib/orchestrator/tokens.ts.
    refreshTokenEncrypted: token.refreshToken ? encryptToken(token.refreshToken) : null,
    refreshTokenExpiresAt: token.refreshExpiresInSeconds ? new Date(Date.now() + token.refreshExpiresInSeconds * 1000) : null,
  };
  if (existing) {
    await prisma.socialAccount.update({ where: { id: existing.id }, data: accountData });
  } else {
    await prisma.socialAccount.create({ data: { platform: "TIKTOK", ...accountData } });
  }

  await logAudit({
    actorEmail: session.user?.email,
    action: "social_account.connected",
    entity: "SocialAccount",
    entityId: token.openId,
    metadata: { platform: "TIKTOK", displayName },
  });

  return NextResponse.redirect(new URL("/", req.url));
}
