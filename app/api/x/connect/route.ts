import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { requireAdminSession } from "@/lib/rbac";

const X_CLIENT_ID = process.env.X_CLIENT_ID;

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// X's OAuth 2.0 requires PKCE -- the code_verifier generated here has to be
// presented again at token-exchange time in the callback, so it's stashed
// in a short-lived httpOnly cookie rather than server-side session storage
// this project doesn't have.
export async function GET(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!X_CLIENT_ID) {
    return NextResponse.json({ error: "X_CLIENT_ID is not configured." }, { status: 503 });
  }

  const redirectUri = new URL("/api/x/callback", req.url).toString();
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  const scopes = ["tweet.read", "tweet.write", "users.read", "offline.access"].join(" ");

  const authUrl = new URL("https://twitter.com/i/oauth2/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", X_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("state", base64url(randomBytes(16)));
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set("x_oauth_verifier", codeVerifier, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/api/x",
  });
  return res;
}
