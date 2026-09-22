"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AnalyticsPanel, { type PerformanceSnapshot } from "@/components/AnalyticsPanel";
import TrendAudiencePanel, { type TrendContext, type AudienceContext } from "@/components/TrendAudiencePanel";

interface Post {
  id: string;
  topic: string;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  videoAgentProductionId: string | null;
  caption: string;
  status: string;
  complianceVerdict: { passed: boolean; reasons: string[] } | null;
  trendContext: TrendContext | null;
  audienceContext: AudienceContext | null;
  externalMediaId: string | null;
  createdAt: string;
  performanceSnapshots: PerformanceSnapshot[];
  account: { platform: "INSTAGRAM" | "TIKTOK" };
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  COMPLIANCE_REJECTED: "bg-rose-50 text-rose-700",
  PENDING_APPROVAL: "bg-amber-50 text-amber-700",
  APPROVED: "bg-blue-50 text-blue-700",
  REJECTED: "bg-rose-50 text-rose-700",
  PUBLISHED: "bg-emerald-50 text-emerald-700",
  PUBLISH_FAILED: "bg-rose-50 text-rose-700",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}

function fieldClass(extra = "") {
  return `block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${extra}`;
}

export default function ApprovalsClient({
  initialPosts,
  hasAccounts,
}: {
  initialPosts: Post[];
  hasAccounts: { INSTAGRAM: boolean; TIKTOK: boolean };
}) {
  const router = useRouter();
  const [platform, setPlatform] = useState<"INSTAGRAM" | "TIKTOK">("INSTAGRAM");
  const [topic, setTopic] = useState("");
  const [mediaSource, setMediaSource] = useState<"url" | "videoAgent">("url");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState<"IMAGE" | "VIDEO">("IMAGE");
  const [videoAgentProductionId, setVideoAgentProductionId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [actioningId, setActioningId] = useState<string | null>(null);

  const hasAccount = hasAccounts[platform];

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const body =
        mediaSource === "videoAgent"
          ? { topic, videoAgentProductionId, platform }
          : { topic, mediaUrl, mediaType, platform };
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create draft.");
        return;
      }
      setTopic("");
      setMediaUrl("");
      setVideoAgentProductionId("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (id: string) => {
    setActioningId(id);
    try {
      const res = await fetch(`/api/posts/${id}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Approve/publish failed.");
      }
      router.refresh();
    } finally {
      setActioningId(null);
    }
  };

  const handleReject = async (id: string) => {
    setActioningId(id);
    try {
      await fetch(`/api/posts/${id}/reject`, { method: "POST" });
      router.refresh();
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div>
      {!hasAccount && (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No {platform === "TIKTOK" ? "TikTok" : "Instagram"} account connected.{" "}
          <a href={platform === "TIKTOK" ? "/api/tiktok/connect" : "/api/meta/connect"} className="font-medium underline">
            Connect one first
          </a>
          .
        </p>
      )}

      <form onSubmit={handleCreateDraft} className="mt-6 flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="inline-flex w-fit rounded-lg bg-slate-100 p-1 text-sm font-medium">
          {(["INSTAGRAM", "TIKTOK"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPlatform(p);
                if (p === "TIKTOK") setMediaType("VIDEO");
              }}
              className={`rounded-md px-4 py-1.5 transition-colors ${
                platform === p ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {p === "INSTAGRAM" ? "Instagram" : "TikTok"}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Topic
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            required
            className={fieldClass()}
            placeholder="e.g. Why service businesses lose leads over the weekend"
          />
        </label>

        <div className="flex gap-5 text-sm text-slate-600">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mediaSource === "url"} onChange={() => setMediaSource("url")} /> Image/video URL
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mediaSource === "videoAgent"} onChange={() => setMediaSource("videoAgent")} /> Video
            Agent production
          </label>
        </div>

        {mediaSource === "url" ? (
          <>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Media URL (must be publicly reachable)
              <input
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                required
                className={fieldClass()}
                placeholder="https://..."
              />
            </label>
            {platform === "INSTAGRAM" && (
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Media type
                <select
                  value={mediaType}
                  onChange={(e) => setMediaType(e.target.value as "IMAGE" | "VIDEO")}
                  className={fieldClass("w-auto")}
                >
                  <option value="IMAGE">Image</option>
                  <option value="VIDEO">Video (Reels)</option>
                </select>
              </label>
            )}
            {platform === "TIKTOK" && <span className="text-xs text-slate-500">TikTok posts are always video.</span>}
          </>
        ) : (
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Video Agent production ID
            <input
              value={videoAgentProductionId}
              onChange={(e) => setVideoAgentProductionId(e.target.value)}
              required
              className={fieldClass()}
              placeholder="production ID from the Video Agent app"
            />
            <span className="text-xs font-normal text-slate-500">
              Generate the video in the separate Video Agent app first, then paste its production ID here.
            </span>
          </label>
        )}

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !hasAccount}
          className="self-start rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? "Drafting..." : "Draft with Content Creation Agent"}
        </button>
      </form>

      <h2 className="mt-10 text-lg font-semibold text-slate-900">Posts</h2>
      {initialPosts.length === 0 && <p className="mt-2 text-sm text-slate-500">No posts yet.</p>}
      <div className="mt-4 flex flex-col gap-4">
        {initialPosts.map((post) => (
          <div key={post.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700">{post.account.platform === "TIKTOK" ? "TikTok" : "Instagram"}</span>
              <span>·</span>
              <StatusBadge status={post.status} />
              <span>·</span>
              <span>{new Date(post.createdAt).toLocaleString()}</span>
            </div>
            <div className="mt-2 font-medium text-slate-900">{post.topic}</div>
            <div className="mt-1 text-xs text-slate-500">
              {post.mediaType === "VIDEO" ? "🎬 Video" : "🖼️ Image"} ·{" "}
              <a href={post.mediaUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                media
              </a>
              {post.videoAgentProductionId && ` (Video Agent: ${post.videoAgentProductionId})`}
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{post.caption}</p>
            {post.complianceVerdict && !post.complianceVerdict.passed && (
              <ul className="mt-3 list-inside list-disc rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
                {post.complianceVerdict.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
            <TrendAudiencePanel trendContext={post.trendContext} audienceContext={post.audienceContext} />
            {post.status === "PUBLISHED" && (
              <>
                <p className="mt-3 text-sm font-medium text-emerald-700">Published — media ID {post.externalMediaId}</p>
                <AnalyticsPanel postId={post.id} latestSnapshot={post.performanceSnapshots[0] ?? null} />
              </>
            )}
            {post.status === "PENDING_APPROVAL" && (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => handleApprove(post.id)}
                  disabled={actioningId === post.id}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Approve & Publish
                </button>
                <button
                  onClick={() => handleReject(post.id)}
                  disabled={actioningId === post.id}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            )}
            {post.status === "PUBLISH_FAILED" && (
              <div className="mt-4">
                <button
                  onClick={() => handleApprove(post.id)}
                  disabled={actioningId === post.id}
                  className="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {actioningId === post.id ? "Retrying..." : "Retry publish"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
