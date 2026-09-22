import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const GRAPH_BASE = "https://graph.instagram.com/v21.0";
const HASHTAG_WEEKLY_LIMIT = 30;

export interface HashtagEnrichment {
  available: boolean;
  hashtags?: { tag: string; topMediaSample: { likeCount: number; commentsCount: number }[] }[];
  reason?: string;
}

export interface TrendSuggestion {
  angle: string;
  format: "IMAGE" | "VIDEO" | "either";
  suggestedHashtags: string[];
  reasoning: string;
  hashtagEnrichment?: HashtagEnrichment;
  generatedAt: string;
}

export function isTrendAgentConfigured(): boolean {
  return Boolean(API_KEY);
}

function neutralTrendSuggestion(topic: string, reasoning: string): TrendSuggestion {
  return {
    angle: topic,
    format: "either",
    suggestedHashtags: [],
    reasoning,
    generatedAt: new Date().toISOString(),
  };
}

// Level 3 Trend Agent -- advisory only, never blocks a draft. Primarily an
// LLM-reasoning agent (Instagram's Graph API exposes no general "trending
// audio/topics" feed -- the only trend-adjacent capability, Hashtag Search,
// is documented against the Facebook-Page-linked login flow this project
// deliberately does NOT use, so it's wired as optional best-effort
// enrichment below, never a dependency).
export async function generateTrendSuggestion(opts: {
  topic: string;
  platform: "INSTAGRAM" | "TIKTOK";
  performanceHistorySummary?: string;
  accessToken?: string;
}): Promise<TrendSuggestion> {
  if (!API_KEY) {
    return neutralTrendSuggestion(opts.topic, "Trend Agent unavailable (not configured) -- using topic as-is.");
  }

  const platformLabel = opts.platform === "TIKTOK" ? "TikTok" : "Instagram";

  let suggestion: TrendSuggestion;
  try {
    const client = new Anthropic({ apiKey: API_KEY });
    const historyBlock = opts.performanceHistorySummary
      ? `\n\nReal performance history from this account's own published posts:\n${opts.performanceHistorySummary}`
      : "";

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system:
        `You are the Trend Agent for SB AI Systems' ${platformLabel} account. Given a topic, reason about ` +
        "what angle, format, and hashtags are likely to perform well for a UK service-business " +
        "audience -- informed by real past performance data when given. You have no live trend " +
        `feed; reason from general knowledge of what tends to work on ${platformLabel}, not fabricated ` +
        'real-time claims. Respond with ONLY this JSON, no other text: {"angle": "...", "format": ' +
        '"IMAGE"|"VIDEO"|"either", "suggestedHashtags": ["tag1","tag2"], "reasoning": "..."}.',
      messages: [{ role: "user", content: `Topic: ${opts.topic}${historyBlock}` }],
    });

    const block = res.content[0];
    if (block.type !== "text") throw new Error("Trend Agent returned an unexpected response type.");
    const match = block.text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Trend Agent response had no parseable JSON.");
    const parsed = JSON.parse(match[0]) as {
      angle?: string;
      format?: string;
      suggestedHashtags?: string[];
      reasoning?: string;
    };

    suggestion = {
      angle: parsed.angle || opts.topic,
      format: parsed.format === "IMAGE" || parsed.format === "VIDEO" ? parsed.format : "either",
      suggestedHashtags: Array.isArray(parsed.suggestedHashtags) ? parsed.suggestedHashtags.slice(0, 5) : [],
      reasoning: parsed.reasoning || "",
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    return neutralTrendSuggestion(
      opts.topic,
      `Trend Agent failed to run (${err instanceof Error ? err.message : "unknown error"}) -- using topic as-is.`
    );
  }

  // Instagram's Hashtag Search API only -- there is no TikTok equivalent
  // wired here, and it would reject a TikTok access token anyway.
  suggestion.hashtagEnrichment =
    opts.platform === "INSTAGRAM"
      ? await queryHashtagEnrichment(suggestion.suggestedHashtags.slice(0, 3), opts.accessToken)
      : { available: false, reason: "Hashtag Search enrichment is Instagram-only." };
  return suggestion;
}

// Best-effort real-data enrichment via Instagram's Hashtag Search API.
// Degrades silently and completely on any failure -- see module docstring
// for why this may simply never work for this account's connection type.
async function queryHashtagEnrichment(hashtags: string[], accessToken?: string): Promise<HashtagEnrichment> {
  if (hashtags.length === 0) {
    return { available: false, reason: "No hashtags suggested to research." };
  }
  if (!accessToken) {
    return { available: false, reason: "No connected Instagram account token available for hashtag research." };
  }

  const withinBudget = await checkHashtagBudget(hashtags);
  if (!withinBudget.ok) {
    return { available: false, reason: withinBudget.reason };
  }

  const results: HashtagEnrichment["hashtags"] = [];
  for (const tag of hashtags) {
    try {
      const searchUrl = new URL(`${GRAPH_BASE}/ig_hashtag_search`);
      searchUrl.searchParams.set("q", tag);
      searchUrl.searchParams.set("access_token", accessToken);
      const searchRes = await fetch(searchUrl.toString());
      if (!searchRes.ok) throw new Error(`hashtag search failed for #${tag}`);
      const searchData = await searchRes.json();
      const hashtagId = searchData?.data?.[0]?.id;
      if (!hashtagId) throw new Error(`no hashtag id returned for #${tag}`);

      const mediaUrl = new URL(`${GRAPH_BASE}/${hashtagId}/top_media`);
      mediaUrl.searchParams.set("fields", "like_count,comments_count");
      mediaUrl.searchParams.set("access_token", accessToken);
      const mediaRes = await fetch(mediaUrl.toString());
      if (!mediaRes.ok) throw new Error(`top_media failed for #${tag}`);
      const mediaData = await mediaRes.json();
      const sample = (mediaData?.data ?? []).slice(0, 5).map((m: { like_count?: number; comments_count?: number }) => ({
        likeCount: m.like_count ?? 0,
        commentsCount: m.comments_count ?? 0,
      }));

      results.push({ tag, topMediaSample: sample });
      await logAudit({ action: "trend_agent.hashtag_query", entity: "TrendAgent", entityId: tag, metadata: { hashtag: tag } });
    } catch (err) {
      await logUnavailableOnce(err instanceof Error ? err.message : "unknown error");
      return { available: false, reason: "Hashtag Search API is not reachable for this account's connection type." };
    }
  }

  return { available: true, hashtags: results };
}

async function checkHashtagBudget(newTags: string[]): Promise<{ ok: boolean; reason?: string }> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recent = await prisma.auditLog.findMany({
    where: { action: "trend_agent.hashtag_query", createdAt: { gte: since } },
    select: { metadata: true },
  });
  const alreadyQueried = new Set(
    recent.map((r) => (r.metadata as { hashtag?: string } | null)?.hashtag).filter(Boolean) as string[]
  );
  const projected = new Set([...alreadyQueried, ...newTags]);
  if (projected.size > HASHTAG_WEEKLY_LIMIT) {
    return { ok: false, reason: `Weekly hashtag search budget (${HASHTAG_WEEKLY_LIMIT}/7 days) would be exceeded.` };
  }
  return { ok: true };
}

async function logUnavailableOnce(reason: string) {
  const existing = await prisma.auditLog.findFirst({ where: { action: "trend_agent.hashtag_enrichment_unavailable" } });
  if (existing) return;
  await logAudit({
    action: "trend_agent.hashtag_enrichment_unavailable",
    entity: "TrendAgent",
    entityId: "hashtag-search",
    metadata: { reason },
  });
}
