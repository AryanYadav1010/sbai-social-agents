"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Post {
  id: string;
  topic: string;
  imageUrl: string;
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
  const [imageUrl, setImageUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [actioningId, setActioningId] = useState<string | null>(null);

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, imageUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create draft.");
        return;
      }
      setTopic("");
      setImageUrl("");
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
        <label>
          Image URL (must be publicly reachable)
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            required
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
            placeholder="https://..."
          />
        </label>
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
