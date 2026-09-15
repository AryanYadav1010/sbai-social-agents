# SB AI Systems — Social Agents

Social AI Agents Ecosystem: **Trend Agent + Audience Agent → Content Creation Agent → Compliance & Policy Agent → Meta Ecosystem Agent (Instagram) → Analytics Agent → Learning Loop**, running at Mode 1 (nothing publishes without explicit human approval). Phase 1 shipped the Orchestrator/Content Creation/Compliance/publish/approval core; Phase 2 added the Intelligence (Trend/Audience), Measurement (Analytics), and Improvement (Learning Loop) layers around it.

This is a separate project from `sbai-systems` — same stack (Next.js App Router, TypeScript, Prisma/Postgres), different repo/deploy target, since it needs its own OAuth/agent infrastructure that doesn't belong on the marketing site.

## Architecture

- `lib/orchestrator/draftGraph.ts` — LangGraph.js `StateGraph`: topic → Trend Agent + Audience Agent run in parallel (both advisory, both fail open) → Content Creation Agent drafts a caption using their guidance → Compliance Agent reviews it. Fixed precedence, not model-judged: Compliance's verdict is final, and nothing Trend/Audience produce can ever block a draft.
- `lib/orchestrator/createDraft.ts` — looks up the account's audience profile and recent performance history, runs the graph, persists the result as a `SocialPost` (`PENDING_APPROVAL` or `COMPLIANCE_REJECTED`) along with the Trend/Audience context that produced it.
- `lib/orchestrator/publish.ts` — runs only after explicit human approval via `/approvals`; publishes through the Meta Ecosystem Agent.
- `lib/agents/contentCreation.ts` — the only agent allowed to produce publish-ready text. Accepts optional advisory context (trend angle, audience targeting, brand voice) but always makes the final call on wording itself.
- `lib/agents/compliance.ts` — deterministic hard-blocks (banned claims, length limits) plus an LLM nuance check. Fails closed if the nuance check errors.
- `lib/agents/trendAgent.ts` — LLM-reasoning Trend Agent (Instagram's Graph API has no general trending-topics feed); optionally enriches its own suggested hashtags via Hashtag Search when a working token/connection type allows it, budget-tracked at 30 hashtags/7 days via `AuditLog`. Degrades silently to reasoning-only if enrichment isn't reachable — never blocks, never retries against a different host.
- `lib/agents/audienceAgent.ts` — LLM agent that turns a one-time-configured business/audience profile (`SocialAccount.audienceProfile`, editable from `/approvals`) into per-draft targeting/tone/CTA guidance. Neutral fallback if no profile is set or the call fails.
- `lib/agents/metaEcosystem.ts` — thin Instagram Graph API client (create media container → wait for processing → publish, plus `getMediaInsights` for per-media analytics). Supports both image posts and video/Reels (`media_type: REELS`, which requires polling `status_code` until `FINISHED` before publish). Insight metrics are queried individually since the Graph API rejects the whole request if any one metric is invalid for that media type.
- `lib/agents/analyticsAgent.ts` — admin-triggered (`POST /api/posts/[id]/analytics`), read-only. Pulls real per-media insights for a `PUBLISHED` post and persists a `PostPerformance` snapshot. No cron/queue infra exists, so refresh is on-demand via the dashboard button rather than automatic.
- `lib/agents/learningLoop.ts` — pure Postgres retrieval (no vector DB, no fine-tuning): summarizes top/bottom-performing recent published posts into a compact text block that Trend/Audience Agents inject into their own prompts. Omits itself entirely until at least 3 posts have performance data.
- `lib/agents/videoAgent.ts` — client for the separate **Video Agent** product (own repo, own deploy: FastAPI + OpenMontage/Remotion). Resolves a Video Agent production ID to a publicly-reachable video URL; the video is always generated over there, never re-implemented here.
- `/approvals` — the human-in-the-loop queue (Mode 1's whole point) and the "Epicenter Dashboard." Drafting a post accepts either a manual media URL or a Video Agent production ID; each post shows its Trend/Audience context and, once published, its latest analytics snapshot with a manual refresh button.

## Setup

1. Copy `.env.example` to `.env.local`, fill in every value (`VIDEO_AGENT_BASE_URL` is optional — only needed to draft posts from a Video Agent production instead of a manual URL).
2. `npm install`
3. `npx prisma migrate dev` (or `migrate deploy` against an existing DB)
4. `npm run dev`
5. Sign in (Google, must be in `ADMIN_EMAILS`), then **Connect Instagram** — requires a Meta app with your Instagram Business/Creator account added as a Tester (bypasses the 2-4 week App Review wait, since Development Mode apps can access tester-added accounts immediately).
6. Optionally, fill in the business/audience profile at the top of `/approvals` (business summary, target audience, brand voice, goals) — this feeds the Audience Agent. It's fully optional; drafts work fine without it.
7. On `/approvals`, draft a post: a topic, plus either a publicly-reachable media URL or a production ID from the Video Agent app (generate the video there first). Review it (including the Trend/Audience notes shown under the caption), approve to actually publish.
8. Once a post is `PUBLISHED`, click "Refresh analytics" on it to pull real engagement numbers. After a few published posts have analytics, later drafts' Trend/Audience guidance will start referencing what has actually performed well.

## Explicitly not in this project

CEO Agent (Level 0), TikTok/YouTube Shorts cluster (replaces the blueprint's original LinkedIn/X cluster per this project's brief), Facebook/WhatsApp specialists, event-driven queue infra (Redis/RabbitMQ — unnecessary at 1-account scale, and why analytics refresh is a manual button rather than automatic), vector DB/RAG knowledge bases (Learning Loop is plain Postgres retrieval instead), Video Intelligence/Business Strategy agents. All real future work, not corners cut — see the blueprint's own Level 9 roadmap for why this stays this narrow.
