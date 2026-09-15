"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface PerformanceSnapshot {
  fetchedAt: string;
  likeCount: number | null;
  commentsCount: number | null;
  savedCount: number | null;
  sharesCount: number | null;
  reach: number | null;
  totalInteractions: number | null;
  unavailableFields: string[];
}

export default function AnalyticsPanel({ postId, latestSnapshot }: { postId: string; latestSnapshot: PerformanceSnapshot | null }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const handleRefresh = async () => {
    setRefreshing(true);
    setError("");
    try {
      const res = await fetch(`/api/posts/${postId}/analytics`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Failed to refresh analytics.");
        return;
      }
      router.refresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div style={{ marginTop: 8, padding: "8px 12px", background: "#f7f9fb", borderRadius: 6, fontSize: 12 }}>
      {latestSnapshot ? (
        <>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 4 }}>
            {latestSnapshot.likeCount != null && <span>❤️ {latestSnapshot.likeCount}</span>}
            {latestSnapshot.commentsCount != null && <span>💬 {latestSnapshot.commentsCount}</span>}
            {latestSnapshot.savedCount != null && <span>🔖 {latestSnapshot.savedCount}</span>}
            {latestSnapshot.sharesCount != null && <span>↗️ {latestSnapshot.sharesCount}</span>}
            {latestSnapshot.reach != null && <span>👁️ reach {latestSnapshot.reach}</span>}
            {latestSnapshot.totalInteractions != null && <span>Σ {latestSnapshot.totalInteractions}</span>}
          </div>
          <div style={{ color: "#888" }}>
            As of {new Date(latestSnapshot.fetchedAt).toLocaleString()}
            {latestSnapshot.unavailableFields.length > 0 && ` · unavailable: ${latestSnapshot.unavailableFields.join(", ")}`}
          </div>
        </>
      ) : (
        <div style={{ color: "#888" }}>No analytics fetched yet.</div>
      )}
      {error && <p style={{ color: "#b42318", marginTop: 4 }}>{error}</p>}
      <button onClick={handleRefresh} disabled={refreshing} style={{ marginTop: 6, padding: "4px 10px", fontSize: 12 }}>
        {refreshing ? "Refreshing..." : "Refresh analytics"}
      </button>
    </div>
  );
}
