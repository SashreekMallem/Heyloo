/**
 * Lean, portable re-implementation of `packages/adapters/retell/src/
 * compiler/*` (T2) for the `/admin-templates/:id/publish` endpoint
 * (BACKEND_SPEC §7.7: "publish runs the compiler + Retell adapter publish
 * call"). This is a DELIBERATE duplication, not a shortcut: `admin` is a
 * Deno Edge Function and `packages/adapters/retell` is a Node-only pnpm
 * workspace package (zero bundling step exists to cross that boundary — see
 * `packages/adapters/README.md` and the provider-isolation note in
 * `docs/BUILD_NOTES.md`'s T3 entry) — the SAME reason every other vendor
 * call under `supabase/functions/` goes through a lean
 * `_shared/providers/<vendor>.ts` fetch client instead of importing a
 * `packages/adapters/*` SDK-style module. This module is that pattern
 * applied to the compiler's pure data-transformation logic rather than a
 * vendor's REST client.
 *
 * Operates directly on `agent_templates`' jsonb column shapes (duck-typed
 * interfaces below, not the canonical-types Zod schema — that package has
 * the identical Node-only import problem) rather than on the canonical
 * `AgentTemplate` TypeScript type. Structural validity (every transition/
 * global-intent/allowed_tools reference resolving to a declared state or
 * tool) is enforced at template-authoring time by
 * `packages/canonical-types`' schema (T2) before a row is ever written here
 * — this compiler defends against a malformed reference the same way T2's
 * did, by silently skipping it, never throwing.
 *
 * FOLLOW-UP (docs/BUILD_NOTES.md): the real fix is extracting the compiler's
 * pure logic into a zero-runtime-dependency package importable by both Node
 * and Deno (`npm:` specifier once published, or a bundled single-file
 * build) so this duplication can be deleted — tracked, not attempted here
 * given T4's scope.
 */

export interface CompilerAgentState {
  id: string;
  name: string;
  prompt_fragment: string;
  allowed_tools: string[];
}

export interface CompilerTransition {
  from: string;
  to: string;
  on?: { intent?: string; predicate?: string };
}

export interface CompilerGlobalIntent {
  name: string;
  target_state: string;
  reachable_from: "any" | string[];
  description: string;
}

export interface CompilerTool {
  name: string;
  description: string;
  parameters: unknown;
}

export interface CompilerAgentTemplate {
  compile_target: "conversation_flow" | "multi_prompt" | "single_prompt";
  system_prompt: string | null;
  states: CompilerAgentState[];
  transitions: CompilerTransition[];
  global_intents: CompilerGlobalIntent[];
  tools: CompilerTool[];
  disclosure_line: string;
}

interface FunctionTool {
  type: "custom";
  tool_id: string;
  name: string;
  description: string;
  url: string;
  parameters: unknown;
}

function toolsFor(template: CompilerAgentTemplate, toolWebhookUrl: string): FunctionTool[] {
  return template.tools.map((tool) => ({
    type: "custom" as const,
    // CALL-1 gap fix (docs/BUILD_NOTES.md): confirmed live against
    // docs.retellai.com/api-references/create-conversation-flow
    // 2026-09-20 — every `tools[]` entry requires a caller-generated
    // `tool_id` (`request/body/tools/0 must have required property
    // 'tool_id'`, seen verbatim from a real 400 response). Tool `name` is
    // already required to be unique within a template's tool set, so it
    // doubles as a stable, deterministic `tool_id` — never randomly
    // generated, so recompiling the same template produces an identical
    // flow body (idempotent, diff-friendly).
    tool_id: tool.name,
    name: tool.name,
    description: tool.description,
    url: toolWebhookUrl,
    // `properties` is REQUIRED per retell-typescript-sdk's `CustomTool.
    // Parameters`, confirmed RETELL-VERIFY — default an omitted one to `{}`
    // (mirrors packages/adapters/retell/src/compiler/*.ts's identical fix).
    parameters:
      tool.parameters && typeof tool.parameters === "object"
        ? { properties: {}, ...tool.parameters }
        : { type: "object", properties: {} },
  }));
}

// ---------------------------------------------------------------------
// conversation_flow
// ---------------------------------------------------------------------

interface ConversationNode {
  id: string;
  type: "conversation";
  name: string;
  instruction: { type: "prompt"; text: string };
  edges: Array<{
    id: string;
    destination_node_id: string;
    transition_condition: { type: "prompt"; prompt: string };
  }>;
  // RETELL-VERIFY (docs/VERIFY.md VERIFY-8, resolved): `tool_ids` is NOT a
  // real field on a plain conversation node (confirmed against
  // retell-typescript-sdk's ConversationFlowCreateParams — it only exists
  // on SubagentNode, a node type this compiler doesn't emit); removed.
  // `global_node_setting: {condition}` replaces the previously-assumed bare
  // `global_node: true` boolean — confirmed an object with a REQUIRED
  // `condition` string. See packages/adapters/retell/src/compiler/types.ts
  // for the full resolved-shape writeup (this file is a deliberate
  // duplicate of that package's compiler, kept in sync — BUILD_NOTES T4/T3).
  global_node_setting?: { condition: string };
}

export interface ConversationFlowBody {
  start_node_id: string;
  // REQUIRED on ConversationFlowCreateParams (RETELL-VERIFY, confirmed via
  // retell-typescript-sdk) — always "agent": every template opens with the
  // agent's own greeting/disclosure line, never a user-speaks-first flow.
  start_speaker: "agent";
  nodes: ConversationNode[];
  tools: FunctionTool[];
  global_prompt?: string;
}

function compileConversationFlow(
  template: CompilerAgentTemplate,
  toolWebhookUrl: string,
): ConversationFlowBody {
  const tools = toolsFor(template, toolWebhookUrl);

  const nodesById = new Map<string, ConversationNode>();
  for (const state of template.states) {
    nodesById.set(state.id, {
      id: state.id,
      type: "conversation",
      name: state.name,
      instruction: { type: "prompt", text: state.prompt_fragment },
      edges: [],
    });
  }

  for (const [index, transition] of template.transitions.entries()) {
    const fromNode = nodesById.get(transition.from);
    if (!fromNode || !nodesById.has(transition.to)) continue;
    fromNode.edges.push({
      id: `edge_${transition.from}_${transition.to}_${index}`,
      destination_node_id: transition.to,
      transition_condition: {
        type: "prompt",
        prompt: transition.on?.intent ?? transition.on?.predicate ?? "",
      },
    });
  }

  for (const globalIntent of template.global_intents) {
    const targetNode = nodesById.get(globalIntent.target_state);
    if (!targetNode) continue;
    if (globalIntent.reachable_from === "any") {
      targetNode.global_node_setting = { condition: globalIntent.description };
      continue;
    }
    for (const fromStateId of globalIntent.reachable_from) {
      const fromNode = nodesById.get(fromStateId);
      if (!fromNode) continue;
      fromNode.edges.push({
        id: `global_${globalIntent.name}_${fromStateId}_${globalIntent.target_state}`,
        destination_node_id: globalIntent.target_state,
        transition_condition: { type: "prompt", prompt: globalIntent.description },
      });
    }
  }

  const startState = template.states[0];
  const startNodeId = startState?.id ?? "";
  if (startState) {
    const startNode = nodesById.get(startState.id);
    if (startNode) {
      startNode.instruction.text = `${template.disclosure_line}\n\n${startNode.instruction.text}`;
    }
  }

  const body: ConversationFlowBody = {
    start_node_id: startNodeId,
    start_speaker: "agent",
    nodes: [...nodesById.values()],
    tools,
  };
  if (template.system_prompt) body.global_prompt = template.system_prompt;
  return body;
}

// ---------------------------------------------------------------------
// multi_prompt
// ---------------------------------------------------------------------

interface MultiPromptState {
  name: string;
  state_prompt: string;
  edges: Array<{ destination_state_name: string; description: string }>;
  tools: FunctionTool[];
}

export interface MultiPromptBody {
  general_prompt: string;
  starting_state: string;
  states: MultiPromptState[];
}

function compileMultiPrompt(
  template: CompilerAgentTemplate,
  toolWebhookUrl: string,
): MultiPromptBody {
  const tools = toolsFor(template, toolWebhookUrl);
  const toolsByName = new Map(tools.map((t) => [t.name, t]));

  const statesByName = new Map<string, MultiPromptState>();
  for (const state of template.states) {
    statesByName.set(state.id, {
      name: state.id,
      state_prompt: state.prompt_fragment,
      edges: [],
      tools: (state.allowed_tools ?? [])
        .map((t) => toolsByName.get(t))
        .filter((t): t is FunctionTool => t !== undefined),
    });
  }

  for (const transition of template.transitions) {
    const fromState = statesByName.get(transition.from);
    if (!fromState || !statesByName.has(transition.to)) continue;
    fromState.edges.push({
      destination_state_name: transition.to,
      description: transition.on?.intent ?? transition.on?.predicate ?? "",
    });
  }

  for (const globalIntent of template.global_intents) {
    if (!statesByName.has(globalIntent.target_state)) continue;
    const sourceIds =
      globalIntent.reachable_from === "any"
        ? [...statesByName.keys()]
        : globalIntent.reachable_from;
    for (const sourceId of sourceIds) {
      if (sourceId === globalIntent.target_state) continue;
      const sourceState = statesByName.get(sourceId);
      if (!sourceState) continue;
      sourceState.edges.push({
        destination_state_name: globalIntent.target_state,
        description: globalIntent.description,
      });
    }
  }

  const startState = template.states[0];
  if (startState) {
    const compiledStart = statesByName.get(startState.id);
    if (compiledStart) {
      compiledStart.state_prompt = `${template.disclosure_line}\n\n${compiledStart.state_prompt}`;
    }
  }

  return {
    general_prompt: template.system_prompt ?? "",
    starting_state: startState?.id ?? "",
    states: [...statesByName.values()],
  };
}

// ---------------------------------------------------------------------
// single_prompt
// ---------------------------------------------------------------------

export interface SinglePromptBody {
  general_prompt: string;
  general_tools: FunctionTool[];
}

function compileSinglePrompt(
  template: CompilerAgentTemplate,
  toolWebhookUrl: string,
): SinglePromptBody {
  const generalTools = toolsFor(template, toolWebhookUrl);

  const sections: string[] = [template.disclosure_line];
  if (template.system_prompt) sections.push(template.system_prompt);
  for (const state of template.states) {
    sections.push(`## ${state.name}\n${state.prompt_fragment}`);
  }
  for (const globalIntent of template.global_intents) {
    const targetFragment =
      template.states.find((s) => s.id === globalIntent.target_state)?.prompt_fragment ??
      globalIntent.target_state;
    sections.push(
      `## Escape: ${globalIntent.name}\nIf ${globalIntent.description}, immediately: ${targetFragment}`,
    );
  }

  return { general_prompt: sections.join("\n\n"), general_tools: generalTools };
}

// ---------------------------------------------------------------------
// disclosure gate (G1/G2) + entry point
// ---------------------------------------------------------------------

export type CompiledFlowRequest =
  | { kind: "conversation_flow"; body: ConversationFlowBody }
  | { kind: "multi_prompt"; body: MultiPromptBody }
  | { kind: "single_prompt"; body: SinglePromptBody };

function firstTurnText(flow: CompiledFlowRequest): string {
  switch (flow.kind) {
    case "conversation_flow": {
      const startNode = flow.body.nodes.find((n) => n.id === flow.body.start_node_id);
      return startNode?.instruction.text ?? "";
    }
    case "multi_prompt": {
      const startState = flow.body.states.find((s) => s.name === flow.body.starting_state);
      return startState?.state_prompt ?? "";
    }
    case "single_prompt":
      return flow.body.general_prompt;
  }
}

/** The G1/G2 disclosure publish gate: refuses to consider a compile
 * "verified" unless `disclosure_line` appears verbatim in the first turn's
 * text. Pure and non-throwing (matches T2's `verifyDisclosureGate`) — the
 * HARD refusal to call Retell lives at the caller (admin/handler.ts), which
 * must check `disclosureVerified` before ever invoking a provider. */
export function verifyDisclosureGate(flow: CompiledFlowRequest, disclosureLine: string): boolean {
  if (disclosureLine.length === 0) return false;
  return firstTurnText(flow).includes(disclosureLine);
}

export interface CompiledTemplate {
  compileTarget: CompilerAgentTemplate["compile_target"];
  disclosureVerified: boolean;
  flow: CompiledFlowRequest;
}

export function compileTemplate(
  template: CompilerAgentTemplate,
  toolWebhookUrl: string,
): CompiledTemplate {
  const flow: CompiledFlowRequest =
    template.compile_target === "conversation_flow"
      ? { kind: "conversation_flow", body: compileConversationFlow(template, toolWebhookUrl) }
      : template.compile_target === "multi_prompt"
        ? { kind: "multi_prompt", body: compileMultiPrompt(template, toolWebhookUrl) }
        : { kind: "single_prompt", body: compileSinglePrompt(template, toolWebhookUrl) };

  return {
    compileTarget: template.compile_target,
    disclosureVerified: verifyDisclosureGate(flow, template.disclosure_line),
    flow,
  };
}
