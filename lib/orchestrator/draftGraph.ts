import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { draftInstagramCaption } from "@/lib/agents/contentCreation";
import { checkCompliance, type ComplianceVerdict } from "@/lib/agents/compliance";

// Level 1 Orchestrator's draft phase, as a real LangGraph.js StateGraph:
// receive objective -> dispatch to Content Creation -> run Compliance check
// -> stop (result determines whether the post is PENDING_APPROVAL or
// COMPLIANCE_REJECTED; publishing itself happens separately, only on
// explicit human approval -- see lib/orchestrator/publish.ts).
//
// Conflict resolution is fixed precedence per the blueprint, not left to
// model discretion: Compliance's verdict is final here, nothing overrides
// it programmatically.

const DraftState = Annotation.Root({
  topic: Annotation<string>(),
  caption: Annotation<string | undefined>(),
  complianceVerdict: Annotation<ComplianceVerdict | undefined>(),
});

async function draftCaptionNode(state: typeof DraftState.State) {
  const caption = await draftInstagramCaption(state.topic);
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
  .addNode("draftCaption", draftCaptionNode)
  .addNode("checkCompliance", checkComplianceNode)
  .addEdge(START, "draftCaption")
  .addEdge("draftCaption", "checkCompliance")
  .addEdge("checkCompliance", END)
  .compile();

export interface DraftResult {
  caption: string;
  complianceVerdict: ComplianceVerdict;
}

export async function runDraftGraph(topic: string): Promise<DraftResult> {
  const result = await graph.invoke({ topic });
  if (!result.caption || !result.complianceVerdict) {
    throw new Error("Draft graph did not produce a complete result.");
  }
  return { caption: result.caption, complianceVerdict: result.complianceVerdict };
}
