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
    <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
      {latestSnapshot ? (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-700">
            {latestSnapshot.likeCount != null && <span>❤️ {latestSnapshot.likeCount}</span>}
            {latestSnapshot.commentsCount != null && <span>💬 {latestSnapshot.commentsCount}</span>}
            {latestSnapshot.savedCount != null && <span>🔖 {latestSnapshot.savedCount}</span>}
            {latestSnapshot.sharesCount != null && <span>↗️ {latestSnapshot.sharesCount}</span>}
            {latestSnapshot.reach != null && <span>👁️ reach {latestSnapshot.reach}</span>}
            {latestSnapshot.totalInteractions != null && <span>Σ {latestSnapshot.totalInteractions}</span>}
          </div>
          <div className="mt-1 text-slate-400">
            As of {new Date(latestSnapshot.fetchedAt).toLocaleString()}
            {latestSnapshot.unavailableFields.length > 0 && ` · unavailable: ${latestSnapshot.unavailableFields.join(", ")}`}
          </div>
        </>
      ) : (
        <div className="text-slate-400">No analytics fetched yet.</div>
      )}
      {error && <p className="mt-1 text-rose-600">{error}</p>}
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        className="mt-2 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {refreshing ? "Refreshing..." : "Refresh analytics"}
      </button>
    </div>
  );
}
