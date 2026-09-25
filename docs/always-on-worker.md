# Always-on worker

Operator guide for the durable, event-driven background worker that turns `sbai-social-agents`
from "generate a post when a human opens the dashboard" into "generate posts on a schedule,
even if nobody is looking, without ever publishing anything without approval by default."

This document assumes you already know the app (dashboard, agents, approval flow). It only
covers the worker: what it is, how it's deployed, how to operate it day to day, and how to
recover when something goes wrong.

## 1. Architecture overview

```
                         ┌─────────────────────────────┐
                         │   Vercel (Next.js app)      │
                         │   - dashboard, /automation   │
                         │   - API routes               │
                         │   - enqueues jobs via         │
                         │     src/worker/queue/enqueue │
                         └──────────────┬───────────────┘
                                        │ INSERT INTO graphile_worker.jobs
                                        ▼
                         ┌─────────────────────────────┐
                         │   Neon Postgres              │
                         │   - app tables (Prisma)       │
                         │   - graphile_worker schema     │
                         │     (its own job queue tables) │
                         └──────────────▲───────────────┘
                        LISTEN/NOTIFY   │  direct connection (WORKER_DATABASE_URL)
                                        │
                         ┌──────────────┴───────────────┐
                         │   Worker process               │
                         │   (Mac mini, launchd, always on)│
                         │   `npm run worker`              │
                         │   - schedulerTick (cron, 1/min)  │
                         │   - maintenance (cron, 1/min)    │
                         │   - refreshPerformance (cron,1/h)│
                         │   - generateSocialDraft, etc.     │
                         │     (queued jobs, on demand)       │
                         └───────────────────────────────┘
```

The worker is **not** an infinite `while (true)` poller. [Graphile Worker](https://worker.graphile.org/)
uses Postgres `LISTEN`/`NOTIFY` to wake up the instant a job is inserted, falling back to a
low-frequency poll only as a safety net. When there is genuinely no due work, the process sits
idle: no Anthropic calls, no platform API calls, no database writes beyond its own heartbeat.
"Always on" means *available*, not *always thinking* -- see [§13 Cost protection](#13-cost-protection-and-safety-model).

Durability lives in Postgres, not in LangGraph: `lib/orchestrator/draftGraph.ts`'s `StateGraph`
runs synchronously inside a single job and is compiled with no checkpointer -- there's no
in-memory graph state that needs to survive a crash, since the graph itself never partially
persists anything. The one genuinely long-running, cross-process step (waiting on a Video Agent
render) is deliberately implemented outside the graph as its own queued jobs backed by
`SocialPost`/`AutomationRun` rows instead. See the comment above `const graph = ...` in that file
for the full reasoning.

## 2. What runs where

| Component | Where | Why |
|---|---|---|
| Next.js app, API routes, `/automation` dashboard | Vercel | Same as today -- no change. |
| App database (Prisma-managed tables: `SocialPost`, `AutomationSchedule`, etc.) | Neon Postgres, pooled connection (`DATABASE_URL`) | Same as today. |
| Job queue (`graphile_worker` schema, managed by Graphile Worker itself, not Prisma) | The **same** Neon Postgres, but via a **direct, non-pooled** connection (`WORKER_DATABASE_URL`) | Graphile Worker needs `LISTEN`/`NOTIFY`, which a PgBouncer transaction-pooling endpoint (the usual Neon `-pooler` URL) does not support correctly. |
| The worker process itself | A dedicated always-on Mac (e.g. a Mac mini), via `launchd` | The spec's explicit deployment target -- see [§4](#4-installing-on-macos-launchd). Nothing about the worker's code is macOS-specific; it would run identically under `pm2`/`systemd` on Linux if you ever move it. |
| Video Agent | Its own separate deployed service, unchanged | The worker calls its existing HTTP API; rendering itself is not reimplemented here. |

## 3. Environment variables

All variables are documented with inline comments in `.env.example`. Summary:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | App's pooled Postgres connection (unchanged). |
| `WORKER_DATABASE_URL` | strongly recommended | **Direct** (non-pooled) Postgres connection for the worker. Falls back to `DATABASE_URL` if unset -- works, but see the warning `npm run worker:check` prints if you do this. |
| `WORKER_CONCURRENCY` | no (default 4) | Max jobs this node runs at once. Protects Anthropic/platform rate limits. |
| `WORKER_HEARTBEAT_SECONDS` | no (default 30) | How often a node writes its heartbeat; "stale" (shown offline) is 3 missed beats. |
| `WORKER_NODE_NAME` | no | Friendly name in the dashboard's worker list. Defaults to OS hostname. |
| `ENABLE_AUTONOMOUS_PUBLISH` | no (default off) | Server-side half of the fully-autonomous-publish gate. See [§12](#12-automation-vs-approval-how-they-interact). |

## 4. Installing on macOS (launchd)

From the project directory on the Mac that will run the worker:

```bash
npm ci
npm run build
cp .env.example .env   # then fill in real values -- see .env.example
npm run db:migrate      # applies Prisma migrations to the app database
./deploy/macos/install.sh
```

`install.sh` installs a **LaunchDaemon** by default -- a system-level service that starts at
boot regardless of whether anyone logs in, which is the right choice for an unattended Mac
mini. It:

- Discovers a real `node` executable (checks Apple Silicon Homebrew, Intel Homebrew, nvm, and
  `PATH`) and bakes its absolute path into a generated wrapper script, since launchd does not
  inherit an interactive shell's `PATH`.
- Runs the daemon as the console user (via the plist's `UserName` key), **not root**.
- Renders the wrapper script into `deploy/macos/run-worker.local.sh` (gitignored -- never
  overwrites the committed template, so the repo stays clean across machines with different
  Node install paths).
- Installs the plist to `/Library/LaunchDaemons/com.sbaisystems.socialworker.plist` (requires
  `sudo` for this one step only) and starts it via `launchctl bootstrap` (the modern
  replacement for the deprecated `load`/`unload`).

No secrets are ever written into the plist -- `run-worker.local.sh` sources `.env` (which stays
on the machine, already gitignored) at runtime.

If the Mac mini is instead configured to **auto-login** as a specific user, you can use a
LaunchAgent instead (`./deploy/macos/install.sh --agent`) -- see the comment at the top of
`deploy/macos/com.sbaisystems.socialworker.agent.plist.template` for the tradeoff. A
LaunchAgent only starts once that user's GUI session begins, so it will **not** come back after
a reboot with nobody physically present to log in. When in doubt, use the default (LaunchDaemon).

## 5. Day-2 operations

```bash
./deploy/macos/status.sh    # is it installed/running? also prints a live DB summary
./deploy/macos/logs.sh      # tail -f the worker's stdout/stderr
./deploy/macos/restart.sh   # restart without reinstalling (launchctl kickstart -k)
./deploy/macos/uninstall.sh # stop it and remove the plist (leaves .env and logs in place)
```

```bash
npm run worker         # canonical entrypoint (what launchd actually runs)
npm run worker:check   # verify config + DB connectivity, generates nothing, safe to run anytime
npm run worker:once     # drain the current queue once and exit (useful for local debugging)
npm run worker:status   # print known worker nodes + schedule/approval counts from the DB
```

## 6. macOS sleep and power settings

A Mac mini that goes to sleep stops running the worker (launchd does not run while the machine
is asleep). For a genuinely always-on deployment:

- **System Settings → Energy** (or `Battery`/`Energy Saver` depending on macOS version): set
  "Prevent automatic sleeping when the display is off" / disable sleep entirely for a
  dedicated, headless machine plugged into power.
- Disable sleep on power loss expectations you can't control (e.g. don't rely on this if the
  Mac is on a laptop running on battery) -- see [§10 recovery scenarios](#10-recovery-scenarios)
  for what happens if it does go offline anyway (nothing bad -- it just catches up, bounded).
- `pmset -g` shows current power settings; `sudo pmset -c sleep 0 displaysleep 10` disables
  system sleep while on AC power (leaving the display free to sleep).

## 7. Verifying reboot survival

After `install.sh`, actually reboot the Mac once to confirm the whole chain works unattended:

1. `sudo reboot`
2. Without opening Terminal, Claude Code, or logging in interactively, wait ~2 minutes.
3. From another machine (or after logging in once just to check, not to start anything
   manually): `./deploy/macos/status.sh` should show the LaunchDaemon running.
4. Open the dashboard's `/automation` page -- the worker status banner should show **online**
   within `WORKER_HEARTBEAT_SECONDS × 3` seconds of the process starting.
5. `npm run worker:status` should list the node with a very recent heartbeat.

This is Definition-of-done scenario **A** -- see [§14](#14-definition-of-done-checklist).

## 8. Running a second worker machine

Nothing here needs coordination beyond what's already built: point a second Mac's `.env` at
the **same** `WORKER_DATABASE_URL`/`DATABASE_URL`, run `./deploy/macos/install.sh` there too.
Both nodes will:

- Register separately in `WorkerNode` (each gets its own row/heartbeat, both shown on the
  dashboard).
- Both pick up the `schedulerTick`/`maintenance`/`refreshPerformance` crons, but Graphile
  Worker's own cron implementation guarantees a given tick only actually enqueues once
  cluster-wide, and `AutomationRun.idempotencyKey`'s unique constraint is a second,
  independent guard against the same scheduled slot ever producing two drafts (see
  `src/worker/tasks/schedulerTick.ts`).
- Share the actual job queue: whichever node is free picks up the next queued job. No job
  ever runs on both nodes -- Graphile Worker uses `SELECT ... FOR UPDATE SKIP LOCKED` under the
  hood for this.

This is Definition-of-done scenario **E**.

## 9. Deployment / upgrade workflow

```bash
git pull
npm ci
npm run build
npm run db:migrate       # applies any new Prisma migrations
npm run worker:restart    # alias-free: ./deploy/macos/restart.sh
```

You do **not** need to re-run `install.sh` for a normal code update -- only if
`deploy/macos/*.template` itself changed (e.g. you added a new environment variable that needs
baking into the plist, which is rare since secrets flow through `.env`, not the plist).

## 10. Rollback

```bash
git checkout <previous-tag-or-commit>
npm ci
npm run build
./deploy/macos/restart.sh
```

Database migrations are additive (new tables/columns/enum values) and were designed not to
require a corresponding down-migration for a code rollback to work -- older code simply ignores
the new columns/tables it doesn't know about. If a specific migration ever needs a real
rollback, write and review that `down` SQL by hand before running it; don't hand-edit
production data as a shortcut.

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Dashboard shows worker offline, but `status.sh` shows it running | Heartbeat stale (>3× `WORKER_HEARTBEAT_SECONDS`) or a clock skew | `npm run worker:status`; check `logs.sh` for repeated crash/restart loops. |
| `worker:check` fails on DB connectivity | Wrong `WORKER_DATABASE_URL`, Neon endpoint paused/asleep, firewall | Confirm the URL is the **direct** (non `-pooler`) host; hit Neon's console to confirm the branch isn't suspended. |
| A schedule never fires | `enabled` is false, or `nextRunAt` is in the future/null | Check via the `/automation` page or `npm run worker:status`; toggling `enabled` on recomputes `nextRunAt`. |
| Posts stuck `NEEDS_MEDIA` | No `MediaAsset`s uploaded for that account | Upload at least one photo/clip on the Automation page's media library. |
| A post is `PUBLISH_AMBIGUOUS` | A previous publish attempt died mid-call; we don't know if it reached the platform | **Manually check the real account first.** If nothing was posted, reset the post via the dashboard to retry; if it was posted, mark it resolved without retrying (never blindly re-approve). |
| Worker won't start after a Mac restart | `launchd` couldn't find `node`, or `.env` is missing | Re-run `install.sh` (re-discovers Node); confirm `.env` exists at the project root. |
| Video render never resolves | Video Agent service itself is down/erroring | Check the Video Agent's own logs; `checkVideoStatus` retries for a bounded number of attempts (~10 min) before marking the post `PUBLISH_FAILED`, it does not poll forever. |

## 12. Automation vs. approval -- how they interact

**Default behavior, every account, out of the box: nothing publishes without a human clicking
Approve.** Automation only decides *when* to generate a draft and *what topic* to write about --
the same Content Creation and Compliance agents the manual dashboard flow already uses do the
actual writing and safety check. A generated draft lands in the Approvals page exactly like a
manually-triggered one, with `PENDING_APPROVAL` (or `COMPLIANCE_REJECTED`, or `NEEDS_MEDIA` if no
media assets are configured).

**Fully autonomous publishing (skip human approval) is opt-in and double-gated**, per the
original spec requirement that this must never be one flip of a switch:

1. **Server-side flag** `ENABLE_AUTONOMOUS_PUBLISH=true` in the worker's `.env` -- off by
   default, and only the person operating the machine can set it.
2. **Per-account opt-in**: on the Automation page, the "Publish automatically, skip human
   approval" checkbox on that account's schedule (`AutomationSchedule.requireApproval = false`).

Both must be true, independently, for a draft to skip the Approvals queue -- see
`src/worker/queue/autoPublishGate.ts`. Flipping the server flag alone does nothing to existing
accounts, since every account defaults to `requireApproval = true`. Turning off approval for one
account while the server flag is off also does nothing (the dashboard checkbox says this
explicitly). Compliance still runs and can still reject content either way; auto-publish only
skips the *human* review step, never the compliance check.

## 13. Cost protection and safety model

- **Idle = zero AI/API calls.** The scheduler tick itself is a cheap DB query
  (`SELECT ... WHERE enabled AND nextRunAt <= now()`), not a model call. Content generation only
  happens for schedules that are actually due.
- **Daily post cap per account** (`AutomationSchedule.postsPerDay`) is enforced before any
  planning/drafting work starts, not after.
- **Video Agent renders are never wasted on rejected content**: for Video-Agent-enabled
  schedules, Compliance runs *before* a render is requested; a rejected draft is saved (with an
  empty media placeholder, for audit visibility) instead of triggering a render that could never
  be published anyway.
- **Bounded catch-up, not unlimited backlog.** If the Mac is off during a scheduled slot,
  `schedulerTick` on the next run simply computes the *next* future `nextRunAt` from the current
  time -- it does not try to "make up" every slot that was missed while offline. A schedule that
  was due once while off produces at most one draft when the worker comes back, not a burst.
- **Idempotent publish.** A retried queue job (at-least-once delivery) cannot create a duplicate
  real-world post -- see `lib/orchestrator/publish.ts` and the `PublishAttempt` state machine.
- **No secrets in logs.** Access tokens are never printed; the worker's own log lines only ever
  reference post/account/run IDs.

## 14. Definition-of-done checklist

Run through these after any significant change to the worker, and certainly before trusting it
unattended on a client's account:

- [ ] **A** -- Install, reboot the Mac, and confirm the worker comes online without anyone
      opening Terminal/Claude Code (see [§7](#7-verifying-reboot-survival)).
- [ ] **B** -- With a schedule enabled and due, confirm a `PENDING_APPROVAL` draft appears and
      nothing gets published, using the default (approval-required) configuration.
- [ ] **C** -- Click Approve on a draft; confirm the API call returns quickly (it enqueues, it
      doesn't block on the network call), the worker publishes shortly after, and the
      `SocialPost` + `AuditLog` end up with the real external media ID.
- [ ] **D** -- Kill the worker process mid-job (`kill -9` its pid while a job is running), then
      restart it; confirm the job resumes/retries and does **not** create a duplicate post.
- [ ] **E** -- Run two worker machines against the same database; confirm both show `ONLINE` on
      the dashboard and jobs are shared, never duplicated (see [§8](#8-running-a-second-worker-machine)).
- [ ] **F** -- With nothing due, confirm zero Anthropic/platform API calls happen (check
      provider dashboards/logs over an idle stretch, or that the automated test suite's mocks
      were never invoked in an idle scenario).

## 15. Secret rotation

Tokens (`TOKEN_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, platform app secrets) live only in `.env`
on each machine, never in a committed file or the launchd plist. To rotate:

1. Update the value in `.env` on every machine that runs either the Vercel app or a worker
   node.
2. `./deploy/macos/restart.sh` on each worker Mac (a plain env change never needs
   `install.sh` again).
3. Redeploy the Vercel app if the same variable is used there too.
4. `npm run worker:check` afterward to confirm the new value actually works before assuming
   the rotation succeeded.

`TOKEN_ENCRYPTION_KEY` specifically: rotating it invalidates every already-stored OAuth token
(they were encrypted with the old key) -- accounts will need to reconnect. Don't rotate it
casually.

## 16. Testing

`npm test` runs the automated suite (Vitest). External services (Anthropic, TikTok/X/Instagram,
Video Agent) and the database are mocked at the module boundary -- **no test in this suite makes
a real network call or publishes real social content.** Coverage focuses on the properties that
are hardest to get right by inspection alone: DST-safe schedule math, the `PublishAttempt`
idempotency state machine (the actual live-API idempotency behavior it's modeled on was also
manually verified once against a real Instagram error response during development -- see git
history for that session, not part of the automated suite), scheduler dedup under a simulated
unique-constraint race, the daily cap and Video-Agent-cost-avoidance branches of
`generateSocialDraft`, and the autonomous-publish dual gate.

## 17. The Learning Loop is not model training

`lib/agents/learningLoop.ts` reads recent post performance from Postgres and folds a short
plain-text summary into future prompts (Content Creation, Planning). This is **retrieval and
prompt context, not fine-tuning** -- no model weights are ever touched, no training job runs
anywhere in this system, and nothing here should be described to a client as "training an AI."
The Planning layer (`lib/orchestrator/planContent.ts`) is the same kind of thing: it decides a
topic/brief by calling Claude with context, it does not adjust how any model behaves going
forward beyond what's already in that one prompt's context window.
