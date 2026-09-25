import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import type { AudienceProfile } from "@/lib/agents/audienceAgent";

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const RECENT_TOPICS_LOOKBACK = 15;

// Level 1.5 Planning layer -- decides WHAT the next autonomous post should
// be about, so a schedule doesn't need a human to type a topic every time.
// Deliberately not a copywriting agent: it hands back a structured brief
// (topic + reasoning + which content pillar it used), never publish-ready
// text. The Content Creation Agent (lib/agents/contentCreation.ts) remains
// the only thing that writes final copy -- this only decides the subject.
//
// This is orchestration/retrieval, the same category as the Learning Loop
// (lib/agents/learningLoop.ts): real past topics and performance data
// feeding a prompt. It is not model training and should never be described
// as training a model to anyone (including in dashboard copy).
export interface ContentBrief {
  topic: string;
  pillarUsed: string | null;
  reasoning: string;
  avoidedTopics: string[];
}

export async function planNextContentBrief(opts: {
  accountId: string;
  platform: "INSTAGRAM" | "TIKTOK" | "X";
  contentPillars: string[];
  campaignBrief?: string | null;
  defaultInstructions?: string | null;
  audienceProfile: AudienceProfile | null;
  performanceHistorySummary?: string;
}): Promise<ContentBrief> {
  const recentPosts = await prisma.socialPost.findMany({
    where: { accountId: opts.accountId },
    orderBy: { createdAt: "desc" },
    take: RECENT_TOPICS_LOOKBACK,
    select: { topic: true },
  });
  const avoidedTopics = recentPosts.map((p) => p.topic);

  // No LLM configured, or nothing to plan against yet -- fall back to a
  // plain pillar rotation rather than failing the whole run. Still
  // structured, still avoids exact repeats, just not LLM-reasoned.
  if (!API_KEY) {
    return fallbackBrief(opts.contentPillars, avoidedTopics);
  }

  try {
    const client = new Anthropic({ apiKey: API_KEY });
    const pillarsBlock = opts.contentPillars.length
      ? `Content pillars to rotate through: ${opts.contentPillars.join(", ")}`
      : "No content pillars configured -- use judgement based on the business profile.";
    const profileBlock = opts.audienceProfile
      ? `Business: ${opts.audienceProfile.businessSummary}\nTarget audience: ${opts.audienceProfile.targetAudience}` +
        (opts.audienceProfile.brandVoice ? `\nBrand voice: ${opts.audienceProfile.brandVoice}` : "") +
        (opts.audienceProfile.goals ? `\nGoals: ${opts.audienceProfile.goals}` : "")
      : "No business profile configured yet -- use generic small-UK-business framing.";
    const campaignBlock = opts.campaignBrief ? `\nCampaign/brand instructions: ${opts.campaignBrief}` : "";
    const defaultsBlock = opts.defaultInstructions ? `\nStanding instructions: ${opts.defaultInstructions}` : "";
    const avoidBlock = avoidedTopics.length
      ? `\n\nRecent topics already used -- pick something genuinely different, not a rephrase of any of these:\n${avoidedTopics.map((t) => `- ${t}`).join("\n")}`
      : "";
    const historyBlock = opts.performanceHistorySummary
      ? `\n\nReal performance history from this account's own published posts:\n${opts.performanceHistorySummary}`
      : "";

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system:
        `You are the Planning layer for an autonomous ${opts.platform} content schedule. Your only ` +
        "job is to decide the SUBJECT of the next post -- a short topic/brief, not the actual " +
        "caption or any publish-ready text. Pick exactly one content pillar to use (if any were " +
        "given) and a specific, concrete angle within it -- not a vague restatement of the pillar " +
        'itself. Respond with ONLY this JSON, no other text: {"topic": "...", "pillarUsed": "..." ' +
        '(or null if none configured), "reasoning": "one sentence on why this topic, now"}.',
      messages: [
        {
          role: "user",
          content: `${pillarsBlock}\n\n${profileBlock}${campaignBlock}${defaultsBlock}${historyBlock}${avoidBlock}`,
        },
      ],
    });

    const block = res.content[0];
    if (block.type !== "text") throw new Error("Planning layer returned an unexpected response type.");
    const match = block.text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Planning layer response had no parseable JSON.");
    const parsed = JSON.parse(match[0]) as { topic?: string; pillarUsed?: string | null; reasoning?: string };
    if (!parsed.topic) throw new Error("Planning layer response missing topic.");

    return {
      topic: parsed.topic,
      pillarUsed: parsed.pillarUsed ?? null,
      reasoning: parsed.reasoning || "",
      avoidedTopics,
    };
  } catch (err) {
    // Fail open into the deterministic rotation rather than blocking the
    // whole scheduled run over a planning-layer hiccup -- Compliance is
    // still the real safety gate downstream, this step only picks a
    // subject.
    const fallback = fallbackBrief(opts.contentPillars, avoidedTopics);
    fallback.reasoning = `Planning layer LLM call failed (${err instanceof Error ? err.message : "unknown error"}) -- used deterministic pillar rotation instead.`;
    return fallback;
  }
}

function fallbackBrief(contentPillars: string[], avoidedTopics: string[]): ContentBrief {
  const pillar = contentPillars.length
    ? contentPillars[Math.floor(Math.random() * contentPillars.length)]
    : null;
  return {
    topic: pillar ?? "A general update from the business",
    pillarUsed: pillar,
    reasoning: pillar
      ? "No Anthropic API key configured -- deterministically rotated to this content pillar."
      : "No content pillars or API key configured -- used a generic placeholder topic.",
    avoidedTopics,
  };
}
