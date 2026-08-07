"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Post {
  id: string;
  topic: string;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  videoAgentProductionId: string | null;
  caption: string;
  status: string;
  complianceVerdict: { passed: boolean; reasons: string[] } | null;
  externalMediaId: string | null;
  createdAt: string;
}

export default function ApprovalsClient({
  initialPosts,
  hasAccount,
}: {
  initialPosts: Post[];
  hasAccount: boolean;
}) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [mediaSource, setMediaSource] = useState<"url" | "videoAgent">("url");
  const [mediaUrl, setMediaUrl] = useState("");
  const [videoAgentProductionId, setVideoAgentProductionId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [actioningId, setActioningId] = useState<string | null>(null);

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const body =
        mediaSource === "videoAgent"
          ? { topic, videoAgentProductionId }
          : { topic, mediaUrl };
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
        <p style={{ background: "#fff3cd", padding: 12, borderRadius: 6 }}>
          No Instagram account connected. <a href="/api/meta/connect">Connect one first</a>.
        </p>
      )}

      <form onSubmit={handleCreateDraft} style={{ margin: "24px 0", display: "flex", flexDirection: "column", gap: 8 }}>
        <label>
          Topic
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            required
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
            placeholder="e.g. Why service businesses lose leads over the weekend"
          />
        </label>
        <div style={{ display: "flex", gap: 16 }}>
          <label>
            <input
              type="radio"
              checked={mediaSource === "url"}
              onChange={() => setMediaSource("url")}
            />{" "}
            Image/video URL
          </label>
          <label>
            <input
              type="radio"
              checked={mediaSource === "videoAgent"}
              onChange={() => setMediaSource("videoAgent")}
            />{" "}
            Video Agent production
          </label>
        </div>

        {mediaSource === "url" ? (
          <label>
            Media URL (must be publicly reachable)
            <input
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              required
              style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
              placeholder="https://..."
            />
          </label>
        ) : (
          <label>
            Video Agent production ID
            <input
              value={videoAgentProductionId}
              onChange={(e) => setVideoAgentProductionId(e.target.value)}
              required
              style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
              placeholder="production ID from the Video Agent app"
            />
            <span style={{ fontSize: 12, color: "#666" }}>
              Generate the video in the separate Video Agent app first, then paste its production ID here.
            </span>
          </label>
        )}
        {error && <p style={{ color: "#b42318" }}>{error}</p>}
        <button type="submit" disabled={submitting || !hasAccount} style={{ padding: "8px 16px" }}>
          {submitting ? "Drafting..." : "Draft with Content Creation Agent"}
        </button>
      </form>

      <h2>Posts</h2>
      {initialPosts.length === 0 && <p>No posts yet.</p>}
      {initialPosts.map((post) => (
        <div key={post.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
            {post.status} · {new Date(post.createdAt).toLocaleString()}
          </div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{post.topic}</div>
          <div style={{ fontSize: 12, marginBottom: 6 }}>
            {post.mediaType === "VIDEO" ? "🎬 Video" : "🖼️ Image"} ·{" "}
            <a href={post.mediaUrl} target="_blank" rel="noreferrer">
              media
            </a>
            {post.videoAgentProductionId && ` (Video Agent: ${post.videoAgentProductionId})`}
          </div>
          <p style={{ whiteSpace: "pre-wrap" }}>{post.caption}</p>
          {post.complianceVerdict && !post.complianceVerdict.passed && (
            <ul style={{ color: "#b42318" }}>
              {post.complianceVerdict.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          {post.status === "PUBLISHED" && (
            <p style={{ color: "#16803d" }}>Published — media ID {post.externalMediaId}</p>
          )}
          {post.status === "PENDING_APPROVAL" && (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={() => handleApprove(post.id)} disabled={actioningId === post.id}>
                Approve & Publish
              </button>
              <button onClick={() => handleReject(post.id)} disabled={actioningId === post.id}>
                Reject
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
