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

export async function draftInstagramCaption(topic: string): Promise<string> {
  if (!API_KEY) {
    throw new Error("Content Creation Agent is not configured (missing ANTHROPIC_API_KEY).");
  }

  const client = new Anthropic({ apiKey: API_KEY });

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system:
      "You are the Content Creation Agent for SB AI Systems' Instagram account. " +
      "Write a single Instagram caption for the given topic: warm, direct, no corporate " +
      "language, 2-4 short sentences, end with 2-4 relevant hashtags on their own line. " +
      "Never invent specific facts, prices, or claims you weren't given. Output ONLY the " +
      "caption text -- no preamble, no explanation, no quotation marks around it.",
    messages: [{ role: "user", content: `Topic: ${topic}` }],
  });

  const block = res.content[0];
  if (block.type !== "text") {
    throw new Error("Content Creation Agent returned an unexpected response type.");
  }
  return block.text.trim();
}
