import { NextResponse } from "next/server";

// TikTok's domain-ownership check for the Content Posting/Login Kit
// redirect URI's domain (URL prefix verification) -- it expects a
// plain-text file reachable under that same URL prefix, containing exactly
// the token TikTok issued when generating the verification file. Serving
// it dynamically here means no static file to keep in sync if TikTok ever
// reissues the token.
const VERIFICATION_CONTENT = "tiktok-developers-site-verification=xIruGw1fabzmS94LY3CH8utCY8RQUxxA";

export async function GET() {
  return new NextResponse(VERIFICATION_CONTENT, {
    headers: { "Content-Type": "text/plain" },
  });
}
