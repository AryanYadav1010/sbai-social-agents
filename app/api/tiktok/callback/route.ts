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

  await prisma.socialAccount.create({
    data: {
      platform: "TIKTOK",
      externalAccountId: token.openId,
      displayName,
      // Refresh token isn't persisted in v1 -- same as Instagram's long-lived
      // token, this account just needs reconnecting via /api/tiktok/connect
      // once the access token expires, no refresh cron in this project yet.
      accessTokenEncrypted: encryptToken(token.accessToken),
      tokenExpiresAt: token.expiresInSeconds ? new Date(Date.now() + token.expiresInSeconds * 1000) : null,
    },
  });

  await logAudit({
    actorEmail: session.user?.email,
    action: "social_account.connected",
    entity: "SocialAccount",
    entityId: token.openId,
    metadata: { platform: "TIKTOK", displayName },
  });

  return NextResponse.redirect(new URL("/", req.url));
}
