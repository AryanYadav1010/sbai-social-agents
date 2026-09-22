import Anthropic from "@anthropic-ai/sdk";

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

// Level 3 Content Creation Agent -- per the blueprint, this is the ONLY
// agent allowed to produce publish-ready text. Everything else in the
// system (Orchestrator, Compliance, the platform clusters) either drafts
// briefs for this agent or reviews/publishes its output, never writes
// captions itself.
export function isContentCreationConfigured(): boolean {
  return Boolean(API_KEY);
}

export interface DraftContext {
  platform?: "INSTAGRAM" | "TIKTOK";
  trendSuggestion?: { angle?: string; format?: string; suggestedHashtags?: string[]; reasoning?: string };
  audienceGuidance?: { targetingNotes?: string; toneAdjustments?: string; callToActionSuggestion?: string };
  brandVoiceOverride?: string;
}

export async function draftInstagramCaption(topic: string, context?: DraftContext): Promise<string> {
  if (!API_KEY) {
    throw new Error("Content Creation Agent is not configured (missing ANTHROPIC_API_KEY).");
  }

  const platformLabel = context?.platform === "TIKTOK" ? "TikTok" : "Instagram";
  const client = new Anthropic({ apiKey: API_KEY });

  const guidanceLines: string[] = [];
  if (context?.trendSuggestion?.angle) guidanceLines.push(`Suggested angle: ${context.trendSuggestion.angle}`);
  if (context?.trendSuggestion?.reasoning) guidanceLines.push(`Trend reasoning: ${context.trendSuggestion.reasoning}`);
  if (context?.trendSuggestion?.suggestedHashtags?.length) {
    guidanceLines.push(`Candidate hashtags: ${context.trendSuggestion.suggestedHashtags.join(", ")}`);
  }
  if (context?.audienceGuidance?.targetingNotes) guidanceLines.push(`Audience targeting: ${context.audienceGuidance.targetingNotes}`);
  if (context?.audienceGuidance?.toneAdjustments) guidanceLines.push(`Tone adjustment: ${context.audienceGuidance.toneAdjustments}`);
  if (context?.audienceGuidance?.callToActionSuggestion) {
    guidanceLines.push(`Call-to-action suggestion: ${context.audienceGuidance.callToActionSuggestion}`);
  }
  if (context?.brandVoiceOverride) guidanceLines.push(`Brand voice: ${context.brandVoiceOverride}`);

  const guidanceBlock =
    guidanceLines.length > 0
      ? `\n\nAdvisory guidance from other agents (use judgement -- you decide the final wording):\n${guidanceLines.join("\n")}`
      : "";

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system:
      `You are the Content Creation Agent for SB AI Systems' ${platformLabel} account. ` +
      `Write a single ${platformLabel} caption for the given topic: warm, direct, no corporate ` +
      "language, 2-4 short sentences, end with 2-4 relevant hashtags on their own line. " +
      "Never invent specific facts, prices, or claims you weren't given. Output ONLY the " +
      "caption text -- no preamble, no explanation, no quotation marks around it.",
    messages: [{ role: "user", content: `Topic: ${topic}${guidanceBlock}` }],
  });

  const block = res.content[0];
  if (block.type !== "text") {
    throw new Error("Content Creation Agent returned an unexpected response type.");
  }
  return block.text.trim();
}
