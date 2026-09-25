import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SB AI Systems — Social Agents",
  description: "AI agent that drafts, reviews, and publishes social content, with human approval before anything goes live.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession(authOptions);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-slate-900">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-sm font-bold text-white">
                SB
              </span>
              SB AI Systems <span className="font-normal text-slate-400">/ Social Agents</span>
            </Link>
            {session?.user?.email && (
              <div className="flex items-center gap-4 text-sm text-slate-500">
                <Link href="/approvals" className="hover:text-slate-900">
                  Approvals
                </Link>
                <Link href="/automation" className="hover:text-slate-900">
                  Automation
                </Link>
                <span className="hidden sm:inline">{session.user.email}</span>
                <Link href="/api/auth/signout" className="rounded-md border border-slate-200 px-3 py-1.5 hover:bg-slate-50">
                  Sign out
                </Link>
              </div>
            )}
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
