"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Account {
  id: string;
  platform: "INSTAGRAM" | "TIKTOK" | "X";
  displayName: string | null;
  externalAccountId: string;
}

interface Run {
  id: string;
  status: string;
  plannedTopic: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface Schedule {
  id: string;
  accountId: string;
  enabled: boolean;
  timezone: string;
  postsPerDay: number;
  allowedDays: number[];
  postingTimes: string[];
  contentPillars: string[];
  campaignBrief: string | null;
  useVideoAgent: boolean;
  requireApproval: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  runs: Run[];
}

interface WorkerNode {
  hostname: string;
  status: string;
  concurrency: number;
  runningJobCount: number;
  lastHeartbeatAt: string;
  startedAt: string;
  appVersion: string | null;
}

interface MediaAsset {
  id: string;
  accountId: string;
  url: string;
  kind: string;
  label: string | null;
}

const PLATFORM_LABELS: Record<string, string> = { INSTAGRAM: "Instagram", TIKTOK: "TikTok", X: "X" };
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fieldClass(extra = "") {
  return `block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${extra}`;
}

export default function AutomationClient({
  accounts,
  initialSchedules,
  workerNodes,
  mediaAssets,
  staleAfterMs,
}: {
  accounts: Account[];
  initialSchedules: Schedule[];
  workerNodes: WorkerNode[];
  mediaAssets: MediaAsset[];
  staleAfterMs: number;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadAccountId, setUploadAccountId] = useState(accounts[0]?.id ?? "");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  // "Online" is a live/volatile read (Date.now()), so it's computed after
  // mount rather than during render -- keeps this component pure per
  // React's render rules, and matches reality better anyway since the
  // server-rendered HTML would otherwise go stale the instant it's cached.
  const [workerOnline, setWorkerOnline] = useState(false);
  useEffect(() => {
    const recompute = () => {
      const staleBefore = Date.now() - staleAfterMs;
      setWorkerOnline(workerNodes.some((n) => n.status === "ONLINE" && new Date(n.lastHeartbeatAt).getTime() >= staleBefore));
    };
    recompute();
    const interval = setInterval(recompute, 10_000);
    return () => clearInterval(interval);
  }, [workerNodes, staleAfterMs]);

  const scheduleByAccount = new Map(initialSchedules.map((s) => [s.accountId, s]));

  const createSchedule = async (accountId: string) => {
    setBusyId(accountId);
    setError("");
    try {
      const res = await fetch("/api/automation/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, enabled: false, timezone: "Europe/London", postsPerDay: 1, postingTimes: ["12:00"] }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Failed to create schedule.");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  const updateSchedule = async (id: string, patch: Partial<Schedule>) => {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/automation/schedules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Failed to update schedule.");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (id: string) => {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/automation/schedules/${id}/run-now`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Failed to queue run.");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  const uploadAsset = async () => {
    if (!uploadFile || !uploadAccountId) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      form.append("accountId", uploadAccountId);
      const res = await fetch("/api/media-assets", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Upload failed.");
      setUploadFile(null);
      router.refresh();
    } finally {
      setUploading(false);
    }
  };

  const deleteAsset = async (id: string) => {
    await fetch(`/api/media-assets/${id}`, { method: "DELETE" });
    router.refresh();
  };

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className={`rounded-xl border p-4 ${workerOnline ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${workerOnline ? "bg-emerald-500" : "bg-rose-500"}`} />
          <span className={`text-sm font-medium ${workerOnline ? "text-emerald-800" : "text-rose-800"}`}>
            Automation worker: {workerOnline ? "online" : "offline"}
          </span>
        </div>
        {!workerOnline && (
          <p className="mt-1 text-sm text-rose-700">
            No worker has a recent heartbeat. Scheduled and manual runs will queue durably and be picked up the
            moment a worker (e.g. `npm run worker` on your always-on machine) comes online -- nothing is lost, it
            just won&apos;t run until then.
          </p>
        )}
        {workerNodes.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
            {workerNodes.map((n) => (
              <li key={n.hostname + n.startedAt}>
                [{n.status}] {n.hostname} — concurrency {n.concurrency}, {n.runningJobCount} job(s) running, last
                heartbeat {new Date(n.lastHeartbeatAt).toLocaleTimeString()}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-600">{error}</p>}

      <div className="flex flex-col gap-4">
        {accounts.map((account) => {
          const schedule = scheduleByAccount.get(account.id);
          return (
            <div key={account.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="font-medium text-slate-900">
                  {PLATFORM_LABELS[account.platform]} — {account.displayName || account.externalAccountId}
                </div>
                {schedule && (
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={schedule.enabled}
                      disabled={busyId === schedule.id}
                      onChange={(e) => updateSchedule(schedule.id, { enabled: e.target.checked })}
                    />
                    Enabled
                  </label>
                )}
              </div>

              {!schedule ? (
                <button
                  onClick={() => createSchedule(account.id)}
                  disabled={busyId === account.id}
                  className="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:bg-slate-300"
                >
                  Set up automation
                </button>
              ) : (
                <div className="mt-4 flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                      Timezone
                      <input
                        defaultValue={schedule.timezone}
                        onBlur={(e) => e.target.value !== schedule.timezone && updateSchedule(schedule.id, { timezone: e.target.value })}
                        className={fieldClass()}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                      Posts/day (cap)
                      <input
                        type="number"
                        min={1}
                        defaultValue={schedule.postsPerDay}
                        onBlur={(e) => updateSchedule(schedule.id, { postsPerDay: Number(e.target.value) })}
                        className={fieldClass()}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                      Posting times (comma-sep HH:mm)
                      <input
                        defaultValue={schedule.postingTimes.join(", ")}
                        onBlur={(e) => updateSchedule(schedule.id, { postingTimes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                        className={fieldClass()}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                      <input
                        type="checkbox"
                        checked={schedule.useVideoAgent}
                        onChange={(e) => updateSchedule(schedule.id, { useVideoAgent: e.target.checked })}
                      />
                      Use Video Agent
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs">
                    {DAY_LABELS.map((label, idx) => (
                      <label key={idx} className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1">
                        <input
                          type="checkbox"
                          checked={schedule.allowedDays.includes(idx)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...schedule.allowedDays, idx]
                              : schedule.allowedDays.filter((d) => d !== idx);
                            updateSchedule(schedule.id, { allowedDays: next });
                          }}
                        />
                        {label}
                      </label>
                    ))}
                  </div>

                  <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                    Content pillars (comma-separated)
                    <input
                      defaultValue={schedule.contentPillars.join(", ")}
                      onBlur={(e) => updateSchedule(schedule.id, { contentPillars: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                      className={fieldClass()}
                      placeholder="Behind the scenes, Customer tips, Case studies"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                    Campaign / brand instructions
                    <textarea
                      defaultValue={schedule.campaignBrief ?? ""}
                      onBlur={(e) => updateSchedule(schedule.id, { campaignBrief: e.target.value })}
                      rows={2}
                      className={fieldClass()}
                    />
                  </label>

                  <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={!schedule.requireApproval}
                      onChange={(e) => updateSchedule(schedule.id, { requireApproval: !e.target.checked })}
                    />
                    <span>
                      <span className="font-semibold">Publish automatically, skip human approval.</span>{" "}
                      Compliance still has to pass, but no one reviews the draft before it goes live. Only takes
                      effect if the server operator has also turned on <code>ENABLE_AUTONOMOUS_PUBLISH</code> —
                      leaving this on otherwise does nothing and drafts still land in Approvals as normal.
                    </span>
                  </label>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span>Next run: {schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : "—"}</span>
                    <span>Last run: {schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString() : "never"}</span>
                    <button
                      onClick={() => runNow(schedule.id)}
                      disabled={busyId === schedule.id}
                      className="rounded-md border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Run now
                    </button>
                  </div>

                  {schedule.runs.length > 0 && (
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="mb-1.5 text-xs font-medium text-slate-600">Recent runs</div>
                      <ul className="space-y-1 text-xs text-slate-600">
                        {schedule.runs.map((r) => (
                          <li key={r.id}>
                            [{r.status}] {r.plannedTopic || "—"} — {new Date(r.startedAt).toLocaleString()}
                            {r.error && <span className="text-rose-600"> — {r.error}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">Media asset library</h2>
        <p className="mt-1 text-xs text-slate-500">
          Only photos/clips uploaded here are ever used by an autonomous run — nothing is scraped, generated, or
          substituted automatically.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <select value={uploadAccountId} onChange={(e) => setUploadAccountId(e.target.value)} className={fieldClass("w-auto")}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {PLATFORM_LABELS[a.platform]} — {a.displayName || a.externalAccountId}
              </option>
            ))}
          </select>
          <input type="file" accept="image/*,video/*" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} className="text-sm" />
          <button
            onClick={uploadAsset}
            disabled={!uploadFile || uploading}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:bg-slate-300"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {mediaAssets.map((asset) => (
            <div key={asset.id} className="relative rounded-lg border border-slate-200 p-2">
              {asset.kind === "video" ? (
                <video src={asset.url} className="h-24 w-full rounded object-cover" muted />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={asset.url} alt={asset.label || ""} className="h-24 w-full rounded object-cover" />
              )}
              <button onClick={() => deleteAsset(asset.id)} className="mt-1 w-full text-xs text-rose-600 hover:underline">
                Remove
              </button>
            </div>
          ))}
          {mediaAssets.length === 0 && <p className="col-span-full text-sm text-slate-400">No media assets uploaded yet.</p>}
        </div>
      </div>
    </div>
  );
}
