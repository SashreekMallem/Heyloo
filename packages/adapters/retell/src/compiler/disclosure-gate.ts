/**
 * The G1/G2 disclosure publish gate (BACKEND_SPEC §1.3, SYSTEM_DESIGN §4.5):
 * "the compiler refuses to publish a template whose compiled output does not
 * contain the disclosure_line verbatim in the first agent turn — a
 * CI/publish gate, not just a code-review convention."
 *
 * The per-target compiler functions (conversation-flow.ts, multi-prompt.ts,
 * single-prompt.ts) are responsible for INJECTING `disclosure_line` verbatim
 * into the first turn's STATIC text as they compile (DISCLOSE-1: a
 * `static_text` opening node / `begin_message`, `opening.ts`). This module is the
 * independent, structural self-check run afterward — belt-and-suspenders
 * against a future refactor accidentally dropping that injection. It never
 * throws itself; `compileTemplate` (index.ts) uses its result to set
 * `CompiledAgentPayload.disclosureVerified`, and the actual HARD refusal to
 * publish happens at the boundary that talks to Retell (agents.ts).
 */

import type { RetellFlowRequest } from "./types.js";

/**
 * DISCLOSE-1 (docs/BUILD_NOTES.md, mirrors `supabase/functions/_shared/
 * compiler/template-compiler.ts#firstUtterance`): the agent's FIRST
 * utterance as Retell will actually produce it — a conversation-flow start
 * node's `static_text`, or a retell-llm `begin_message` with the agent
 * speaking first. Anything else (a prompt start node, an unset
 * `begin_message`) is model-generated and reported non-static: VERIFY-DEPLOY
 * heard "this call may be recorded" paraphrased away on live calls whose
 * start-node PROMPT contained it verbatim.
 */
export interface FirstUtterance {
  isStatic: boolean;
  text: string;
}

export function firstUtterance(flowRequest: RetellFlowRequest): FirstUtterance {
  switch (flowRequest.kind) {
    case "conversation_flow": {
      const startNode = flowRequest.body.nodes.find((n) => n.id === flowRequest.body.start_node_id);
      if (startNode?.type !== "conversation") return { isStatic: false, text: "" };
      return {
        isStatic: startNode.instruction.type === "static_text",
        text: startNode.instruction.text,
      };
    }
    case "multi_prompt":
    case "single_prompt": {
      const { begin_message: beginMessage, start_speaker: startSpeaker } = flowRequest.body;
      return beginMessage && startSpeaker === "agent"
        ? { isStatic: true, text: beginMessage }
        : { isStatic: false, text: "" };
    }
  }
}

/** Back-compat accessor: the first utterance's text, static or not. */
export function firstTurnText(flowRequest: RetellFlowRequest): string {
  return firstUtterance(flowRequest).text;
}

/** The G1/G2 gate: passes only when the first utterance is STATIC and carries `disclosureLine` verbatim. */
export function verifyDisclosureGate(
  flowRequest: RetellFlowRequest,
  disclosureLine: string,
): boolean {
  if (disclosureLine.length === 0) return false;
  const first = firstUtterance(flowRequest);
  return first.isStatic && first.text.includes(disclosureLine);
}
