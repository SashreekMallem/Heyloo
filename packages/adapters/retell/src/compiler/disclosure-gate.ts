/**
 * The G1/G2 disclosure publish gate (BACKEND_SPEC §1.3, SYSTEM_DESIGN §4.5):
 * "the compiler refuses to publish a template whose compiled output does not
 * contain the disclosure_line verbatim in the first agent turn — a
 * CI/publish gate, not just a code-review convention."
 *
 * The per-target compiler functions (conversation-flow.ts, multi-prompt.ts,
 * single-prompt.ts) are responsible for INJECTING `disclosure_line` verbatim
 * into the first turn's text as they compile. This module is the
 * independent, structural self-check run afterward — belt-and-suspenders
 * against a future refactor accidentally dropping that injection. It never
 * throws itself; `compileTemplate` (index.ts) uses its result to set
 * `CompiledAgentPayload.disclosureVerified`, and the actual HARD refusal to
 * publish happens at the boundary that talks to Retell (agents.ts).
 */

import type { RetellFlowRequest } from "./types.js";

export function firstTurnText(flowRequest: RetellFlowRequest): string {
  switch (flowRequest.kind) {
    case "conversation_flow": {
      const startNode = flowRequest.body.nodes.find((n) => n.id === flowRequest.body.start_node_id);
      return startNode && startNode.type === "conversation" ? startNode.instruction.text : "";
    }
    case "multi_prompt": {
      const startState = flowRequest.body.states.find(
        (s) => s.name === flowRequest.body.starting_state,
      );
      return startState?.state_prompt ?? "";
    }
    case "single_prompt":
      return flowRequest.body.general_prompt;
  }
}

export function verifyDisclosureGate(
  flowRequest: RetellFlowRequest,
  disclosureLine: string,
): boolean {
  if (disclosureLine.length === 0) return false;
  return firstTurnText(flowRequest).includes(disclosureLine);
}
