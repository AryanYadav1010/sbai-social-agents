"use client";

import { useState } from "react";
import type { AudienceProfile } from "@/lib/agents/audienceAgent";

function fieldClass(extra = "") {
  return `block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${extra}`;
}

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
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-5 py-3.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
        Audience Agent profile
        <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${initialProfile ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
          {initialProfile ? "configured" : "using generic brand voice"}
        </span>
      </button>
      {open && (
        <form onSubmit={handleSave} className="flex flex-col gap-4 border-t border-slate-200 p-5">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Business summary
            <textarea
              value={businessSummary}
              onChange={(e) => setBusinessSummary(e.target.value)}
              required
              rows={2}
              className={fieldClass()}
              placeholder="e.g. SB AI Systems — an AI-powered business management platform for UK service businesses."
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Target audience
            <textarea
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
              required
              rows={2}
              className={fieldClass()}
              placeholder="e.g. Trade & contractor business owners, facilities managers, small service business operators in the UK."
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Brand voice (optional)
            <input
              value={brandVoice}
              onChange={(e) => setBrandVoice(e.target.value)}
              className={fieldClass()}
              placeholder="e.g. Warm, direct, no corporate jargon."
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Current goals (optional)
            <input
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              className={fieldClass()}
              placeholder="e.g. Drive demo bookings from trade businesses."
            />
          </label>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {saved && <p className="text-sm text-emerald-600">Saved.</p>}
          <button
            type="submit"
            disabled={saving}
            className="self-start rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving ? "Saving..." : "Save profile"}
          </button>
        </form>
      )}
    </div>
  );
}
