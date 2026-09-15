"use client";

import { useState } from "react";
import type { AudienceProfile } from "@/lib/agents/audienceAgent";

export default function BusinessProfileEditor({ initialProfile }: { initialProfile: AudienceProfile | null }) {
  const [open, setOpen] = useState(!initialProfile);
  const [businessSummary, setBusinessSummary] = useState(initialProfile?.businessSummary ?? "");
  const [targetAudience, setTargetAudience] = useState(initialProfile?.targetAudience ?? "");
  const [brandVoice, setBrandVoice] = useState(initialProfile?.brandVoice ?? "");
  const [goals, setGoals] = useState(initialProfile?.goals ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/business-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessSummary, targetAudience, brandVoice, goals }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save.");
        return;
      }
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, marginBottom: 24 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ width: "100%", textAlign: "left", padding: 12, background: "#f7f7f7", border: "none", cursor: "pointer", fontWeight: 600 }}
      >
        {open ? "▾" : "▸"} Audience Agent profile {initialProfile ? "(configured)" : "(not configured — using generic brand voice)"}
      </button>
      {open && (
        <form onSubmit={handleSave} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <label>
            Business summary
            <textarea
              value={businessSummary}
              onChange={(e) => setBusinessSummary(e.target.value)}
              required
              rows={2}
              style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
              placeholder="e.g. SB AI Systems — an AI-powered business management platform for UK service businesses."
            />
          </label>
          <label>
            Target audience
            <textarea
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
              required
              rows={2}
              style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
              placeholder="e.g. Trade & contractor business owners, facilities managers, small service business operators in the UK."
            />
          </label>
          <label>
            Brand voice (optional)
            <input
              value={brandVoice}
              onChange={(e) => setBrandVoice(e.target.value)}
              style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
              placeholder="e.g. Warm, direct, no corporate jargon."
            />
          </label>
          <label>
            Current goals (optional)
            <input
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
              placeholder="e.g. Drive demo bookings from trade businesses."
            />
          </label>
          {error && <p style={{ color: "#b42318" }}>{error}</p>}
          {saved && <p style={{ color: "#16803d" }}>Saved.</p>}
          <button type="submit" disabled={saving} style={{ padding: "8px 16px", alignSelf: "flex-start" }}>
            {saving ? "Saving..." : "Save profile"}
          </button>
        </form>
      )}
    </div>
  );
}
