// Level 3 Audience Agent -- advisory only, never blocks a draft. Decides who
// content should target, given a business profile the admin configures once
// via the dashboard.

import Anthropic from "@anthropic-ai/sdk";

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

export interface AudienceProfile {
  businessSummary: string;
  targetAudience: string;
  brandVoice?: string;
  goals?: string;
}

export interface AudienceGuidance {
  targetingNotes: string;
  toneAdjustments?: string;
  callToActionSuggestion?: string;
  generatedAt: string;
}

export function isAudienceAgentConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// A neutral, always-safe fallback -- used when no profile is configured yet,
// or if the agent's own LLM call fails. Never throws, never blocks drafting.
export function neutralAudienceGuidance(): AudienceGuidance {
  return {
    targetingNotes: "No audience profile configured yet -- using general SB AI Systems brand voice.",
    generatedAt: new Date().toISOString(),
  };
}

export async function generateAudienceGuidance(opts: {
  topic: string;
  profile: AudienceProfile | null;
  performanceHistorySummary?: string;
}): Promise<AudienceGuidance> {
  if (!opts.profile || !API_KEY) {
    return neutralAudienceGuidance();
  }

  try {
    const client = new Anthropic({ apiKey: API_KEY });
    const historyBlock = opts.performanceHistorySummary
      ? `\n\nReal performance history from this account's own published posts:\n${opts.performanceHistorySummary}`
      : "";
    const profileBlock = [
      `Business: ${opts.profile.businessSummary}`,
      `Target audience: ${opts.profile.targetAudience}`,
      opts.profile.brandVoice ? `Brand voice: ${opts.profile.brandVoice}` : null,
      opts.profile.goals ? `Goals: ${opts.profile.goals}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system:
        "You are the Audience Agent for a business's Instagram account. Given the business's own " +
        "profile and a post topic, advise how to target and phrase the post for that specific " +
        "audience -- informed by real past performance data when given. " +
        'Respond with ONLY this JSON, no other text: {"targetingNotes": "...", "toneAdjustments": ' +
        '"..." (optional), "callToActionSuggestion": "..." (optional)}.',
      messages: [{ role: "user", content: `${profileBlock}\n\nPost topic: ${opts.topic}${historyBlock}` }],
    });

    const block = res.content[0];
    if (block.type !== "text") throw new Error("Audience Agent returned an unexpected response type.");
    const match = block.text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Audience Agent response had no parseable JSON.");
    const parsed = JSON.parse(match[0]) as {
      targetingNotes?: string;
      toneAdjustments?: string;
      callToActionSuggestion?: string;
    };

    if (!parsed.targetingNotes) throw new Error("Audience Agent response missing targetingNotes.");

    return {
      targetingNotes: parsed.targetingNotes,
      toneAdjustments: parsed.toneAdjustments,
      callToActionSuggestion: parsed.callToActionSuggestion,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return neutralAudienceGuidance();
  }
}
