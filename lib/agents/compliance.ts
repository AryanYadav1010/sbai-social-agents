import Anthropic from "@anthropic-ai/sdk";

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

export interface ComplianceVerdict {
  passed: boolean;
  reasons: string[];
  checkedAt: string;
}

// Deterministic hard-blocks, checked first and always -- these never depend
// on an LLM call being available or correct. Per the blueprint: "Safety
// logic shouldn't be left to model discretion."
const BANNED_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bguaranteed?\b/i, reason: "Contains an unqualified guarantee claim." },
  { pattern: /\b(#1|number one|best in the world)\b/i, reason: "Contains an unverifiable superlative claim." },
  { pattern: /\b(100% (safe|secure|free))\b/i, reason: "Contains an absolute safety/security claim that can't be substantiated in one line." },
  { pattern: /\b(cure|treat|diagnos\w*)\b/i, reason: "Contains medical claim language, out of scope for this account." },
  { pattern: /\b(send us your (password|card|bank) details?)\b/i, reason: "Solicits sensitive personal/financial information." },
];

const MAX_CAPTION_LENGTH = 2200; // Instagram's actual caption limit

export async function checkCompliance(caption: string): Promise<ComplianceVerdict> {
  const reasons: string[] = [];

  for (const { pattern, reason } of BANNED_PATTERNS) {
    if (pattern.test(caption)) reasons.push(reason);
  }

  if (caption.length > MAX_CAPTION_LENGTH) {
    reasons.push(`Caption is ${caption.length} characters, exceeds Instagram's ${MAX_CAPTION_LENGTH}-character limit.`);
  }

  if (reasons.length > 0) {
    // Hard-blocked already -- don't bother spending an LLM call.
    return { passed: false, reasons, checkedAt: new Date().toISOString() };
  }

  if (!API_KEY) {
    // No LLM check available -- pass on deterministic rules alone rather
    // than blocking everything just because the nuance-check is offline.
    return { passed: true, reasons: [], checkedAt: new Date().toISOString() };
  }

  const llmReasons = await runNuanceCheck(caption);
  return {
    passed: llmReasons.length === 0,
    reasons: llmReasons,
    checkedAt: new Date().toISOString(),
  };
}

async function runNuanceCheck(caption: string): Promise<string[]> {
  try {
    const client = new Anthropic({ apiKey: API_KEY! });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system:
        "You are the Compliance & Policy Agent for SB AI Systems' Instagram account. " +
        "Review the caption for: misleading claims, competitor disparagement, off-brand " +
        "tone (should be warm, direct, no corporate jargon), or anything a reasonable " +
        "brand-safety reviewer would flag. Respond with ONLY this JSON, no other text: " +
        '{"issues": ["issue 1", "issue 2"]} -- an empty array if there are no issues.',
      messages: [{ role: "user", content: caption }],
    });
    const block = res.content[0];
    if (block.type !== "text") return [];
    const match = block.text.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as { issues?: string[] };
    return parsed.issues ?? [];
  } catch {
    // If the nuance check itself errors, don't silently pass a caption that
    // was never actually reviewed -- fail closed with a clear reason.
    return ["Compliance nuance check failed to run -- needs manual review."];
  }
}
