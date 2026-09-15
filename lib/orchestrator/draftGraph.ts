import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { draftInstagramCaption } from "@/lib/agents/contentCreation";
import { checkCompliance, type ComplianceVerdict } from "@/lib/agents/compliance";
import { generateTrendSuggestion, type TrendSuggestion } from "@/lib/agents/trendAgent";
import { generateAudienceGuidance, type AudienceGuidance, type AudienceProfile } from "@/lib/agents/audienceAgent";

// Level 1 Orchestrator's draft phase, as a real LangGraph.js StateGraph:
// receive objective -> fan out to Trend Agent + Audience Agent in parallel
// (both advisory, both fail open) -> fan in to Social Agent (content
// drafting) -> run Compliance check -> stop (result determines whether the
// post is PENDING_APPROVAL or COMPLIANCE_REJECTED; publishing itself
// happens separately, only on explicit human approval -- see
// lib/orchestrator/publish.ts).
//
// Conflict resolution is fixed precedence per the blueprint, not left to
// model discretion: Compliance's verdict is final here, nothing overrides
// it programmatically. Trend/Audience can never block -- both agents
// already degrade internally to a neutral fallback, and the node wrappers
// below add a second layer of try/catch on top of that so a bug in either
// agent can never take down drafting.

const DraftState = Annotation.Root({
  topic: Annotation<string>(),
  accessToken: Annotation<string | undefined>(),
  audienceProfile: Annotation<AudienceProfile | null | undefined>(),
  performanceHistorySummary: Annotation<string | undefined>(),
  trendSuggestion: Annotation<TrendSuggestion | undefined>(),
  audienceGuidance: Annotation<AudienceGuidance | undefined>(),
  caption: Annotation<string | undefined>(),
  complianceVerdict: Annotation<ComplianceVerdict | undefined>(),
});

async function trendNode(state: typeof DraftState.State) {
  try {
    const trendSuggestion = await generateTrendSuggestion({
      topic: state.topic,
      performanceHistorySummary: state.performanceHistorySummary,
      accessToken: state.accessToken,
    });
    return { trendSuggestion };
  } catch {
    return { trendSuggestion: undefined };
  }
}

async function audienceNode(state: typeof DraftState.State) {
  try {
    const audienceGuidance = await generateAudienceGuidance({
      topic: state.topic,
      profile: state.audienceProfile ?? null,
      performanceHistorySummary: state.performanceHistorySummary,
    });
    return { audienceGuidance };
  } catch {
    return { audienceGuidance: undefined };
  }
}

async function socialAgentNode(state: typeof DraftState.State) {
  const caption = await draftInstagramCaption(state.topic, {
    trendSuggestion: state.trendSuggestion,
    audienceGuidance: state.audienceGuidance,
    brandVoiceOverride: state.audienceProfile?.brandVoice,
  });
  return { caption };
}

async function checkComplianceNode(state: typeof DraftState.State) {
  if (!state.caption) {
    throw new Error("checkComplianceNode reached with no caption drafted.");
  }
  const complianceVerdict = await checkCompliance(state.caption);
  return { complianceVerdict };
}

const graph = new StateGraph(DraftState)
  .addNode("trendAgent", trendNode)
  .addNode("audienceAgent", audienceNode)
  .addNode("socialAgent", socialAgentNode)
  .addNode("checkCompliance", checkComplianceNode)
  .addEdge(START, "trendAgent")
  .addEdge(START, "audienceAgent")
  .addEdge("trendAgent", "socialAgent")
  .addEdge("audienceAgent", "socialAgent")
  .addEdge("socialAgent", "checkCompliance")
  .addEdge("checkCompliance", END)
  .compile();

export interface DraftResult {
  caption: string;
  complianceVerdict: ComplianceVerdict;
  trendSuggestion?: TrendSuggestion;
  audienceGuidance?: AudienceGuidance;
}

export async function runDraftGraph(opts: {
  topic: string;
  accessToken?: string;
  audienceProfile?: AudienceProfile | null;
  performanceHistorySummary?: string;
}): Promise<DraftResult> {
  const result = await graph.invoke({
    topic: opts.topic,
    accessToken: opts.accessToken,
    audienceProfile: opts.audienceProfile,
    performanceHistorySummary: opts.performanceHistorySummary,
  });
  if (!result.caption || !result.complianceVerdict) {
    throw new Error("Draft graph did not produce a complete result.");
  }
  return {
    caption: result.caption,
    complianceVerdict: result.complianceVerdict,
    trendSuggestion: result.trendSuggestion,
    audienceGuidance: result.audienceGuidance,
  };
}
