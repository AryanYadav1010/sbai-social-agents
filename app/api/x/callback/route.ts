import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { encryptToken } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { exchangeXCode, getXHandle } from "@/lib/agents/xEcosystem";

const X_CLIENT_ID = process.env.X_CLIENT_ID;
const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET;

export async function GET(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!X_CLIENT_ID || !X_CLIENT_SECRET) {
    return NextResponse.json({ error: "X_CLIENT_ID/X_CLIENT_SECRET are not configured." }, { status: 503 });
  }

  const code = req.nextUrl.searchParams.get("code");
  const oauthError = req.nextUrl.searchParams.get("error");
  if (oauthError) {
    return NextResponse.json({ error: oauthError }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: "Missing OAuth code." }, { status: 400 });
  }

  const codeVerifier = req.cookies.get("x_oauth_verifier")?.value;
  if (!codeVerifier) {
    return NextResponse.json(
      { error: "Missing PKCE verifier cookie -- the OAuth flow expired or was started in a different browser session. Try connecting again." },
      { status: 400 }
    );
  }

  const redirectUri = new URL("/api/x/callback", req.url).toString();

  const token = await exchangeXCode(code, redirectUri, codeVerifier, X_CLIENT_ID, X_CLIENT_SECRET);
  if (!token.ok || !token.accessToken) {
    return NextResponse.json({ error: token.error || "X token exchange failed." }, { status: 502 });
  }

  const handle = await getXHandle(token.accessToken);
  const displayName = handle ? `@${handle}` : "X account";

  // Update in place if an X account row already exists -- same reasoning
  // as the TikTok callback: reconnecting must replace the old token, not
  // sit next to it as a row a plain findFirst() might not return.
  const existing = await prisma.socialAccount.findFirst({ where: { platform: "X" } });
  const accountData = {
    externalAccountId: handle || "unknown",
    displayName,
    accessTokenEncrypted: encryptToken(token.accessToken),
    tokenExpiresAt: token.expiresInSeconds ? new Date(Date.now() + token.expiresInSeconds * 1000) : null,
    // X access tokens last 2h; the refresh token lets publishing renew them (lib/orchestrator/tokens.ts).
    refreshTokenEncrypted: token.refreshToken ? encryptToken(token.refreshToken) : null,
  };
  if (existing) {
    await prisma.socialAccount.update({ where: { id: existing.id }, data: accountData });
  } else {
    await prisma.socialAccount.create({ data: { platform: "X", ...accountData } });
  }

  await logAudit({
    actorEmail: session.user?.email,
    action: "social_account.connected",
    entity: "SocialAccount",
    entityId: handle || "unknown",
    metadata: { platform: "X", handle },
  });

  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.delete("x_oauth_verifier");
  return res;
}
