# SB AI Systems — Social Agents

Phase 1 MVP of the Social AI Agents Ecosystem blueprint: **Orchestrator → Meta Ecosystem Agent (Instagram) → Content Creation Agent → Compliance & Policy Agent**, running at Mode 1 (nothing publishes without explicit human approval).

This is a separate project from `sbai-systems` — same stack (Next.js App Router, TypeScript, Prisma/Postgres), different repo/deploy target, since it needs its own OAuth/agent infrastructure that doesn't belong on the marketing site.

## Architecture

- `lib/orchestrator/draftGraph.ts` — LangGraph.js `StateGraph`: topic → Content Creation Agent drafts a caption → Compliance Agent reviews it. Fixed precedence, not model-judged: Compliance's verdict is final.
- `lib/orchestrator/createDraft.ts` — persists the graph's result as a `SocialPost` (`PENDING_APPROVAL` or `COMPLIANCE_REJECTED`).
- `lib/orchestrator/publish.ts` — runs only after explicit human approval via `/approvals`; publishes through the Meta Ecosystem Agent.
- `lib/agents/contentCreation.ts` — the only agent allowed to produce publish-ready text.
- `lib/agents/compliance.ts` — deterministic hard-blocks (banned claims, length limits) plus an LLM nuance check. Fails closed if the nuance check errors.
- `lib/agents/metaEcosystem.ts` — thin Instagram Graph API client (create media container → wait for processing → publish). Supports both image posts and video/Reels (`media_type: REELS`, which requires polling `status_code` until `FINISHED` before publish).
- `lib/agents/videoAgent.ts` — client for the separate **Video Agent** product (own repo, own deploy: FastAPI + OpenMontage/Remotion). Resolves a Video Agent production ID to a publicly-reachable video URL; the video is always generated over there, never re-implemented here.
- `/approvals` — the human-in-the-loop queue (Mode 1's whole point). Drafting a post accepts either a manual media URL or a Video Agent production ID.

## Setup

1. Copy `.env.example` to `.env.local`, fill in every value (`VIDEO_AGENT_BASE_URL` is optional — only needed to draft posts from a Video Agent production instead of a manual URL).
2. `npm install`
3. `npx prisma migrate dev` (or `migrate deploy` against an existing DB)
4. `npm run dev`
5. Sign in (Google, must be in `ADMIN_EMAILS`), then **Connect Instagram** — requires a Meta app with your Instagram Business/Creator account added as a Tester (bypasses the 2-4 week App Review wait, since Development Mode apps can access tester-added accounts immediately).
6. On `/approvals`, draft a post: a topic, plus either a publicly-reachable media URL or a production ID from the Video Agent app (generate the video there first). Review it, approve to actually publish.

## Explicitly not in Phase 1

CEO Agent (Level 0), TikTok/YouTube Shorts cluster (Phase 2 — replaces the blueprint's original LinkedIn/X cluster per this project's brief), Facebook/WhatsApp specialists, event-driven queue infra (Redis/RabbitMQ — unnecessary at 1-account scale), vector DB/RAG knowledge bases, Trend Intelligence/Audience Research/Video Intelligence/Business Strategy agents. All real future work, not corners cut — see the blueprint's own Level 9 roadmap for why Phase 1 stays this narrow.
