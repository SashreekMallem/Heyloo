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

/**
 * ANALYSIS-1 (docs/BUILD_NOTES.md): a state's own declared post-call
 * extraction fields — `agent-template-seeds.ts` has carried these on every
 * shipped template's states for several tasks now (CALL-9 and earlier), but
 * until this task nothing ever read them: `CompilerAgentState` itself never
 * declared this property (every seed's `states` array only reached this
 * compiler via `as unknown as CompilerAgentTemplate`, which bypasses excess-
 * property checking — see that file's own header), so the data was
 * compiled, published, and silently dropped on every agent this platform
 * ever created. `buildPostCallAnalysisData` below is the fix: it actually
 * reads this field and turns it into Retell's real `post_call_analysis_data`
 * shape.
 *
 * Field-name choices below intentionally mirror `agent-template-seeds.ts`'s
 * existing (previously-dead) shape exactly, rather than Retell's own
 * `PostCallAnalysisData` field names (`name`/`choices`/`string`) — so no
 * template content has to change, only this compiler. `buildPostCallAnalysisData`
 * does the translation.
 */
export interface CompilerExtractionField {
  /** Becomes Retell's `name` (RETELL-VERIFIED, docs.retellai.com/api-references/create-agent 2026-09-21). */
  field: string;
  /** `"text"` becomes Retell's `"string"`; the other three are already
   * Retell's own literal type names, confirmed via the same fetch. */
  type: "text" | "enum" | "boolean" | "number";
  /** Only meaningful (and only required by Retell) for `type: "enum"` —
   * becomes Retell's `choices`. */
  enum_values?: string[];
  /** Becomes Retell's `description` (REQUIRED on every type per the docs);
   * `buildPostCallAnalysisData` fills a generic fallback when a state
   * omits it (e.g. every `legal_advice_given` declaration in
   * `agent-template-seeds.ts` today) rather than sending Retell an empty
   * string. */
  description?: string;
}

export interface CompilerAgentState {
  id: string;
  name: string;
  prompt_fragment: string;
  allowed_tools: string[];
  /** CALL-2 (docs/BUILD_NOTES.md): previously declared on the canonical
   * `AgentState` type but never read by this compiler at all — see
   * `EndNode`'s own doc comment for the live bug that left unfixed. */
  is_terminal?: boolean;
  /** ANALYSIS-1: see `CompilerExtractionField`'s own doc comment above. */
  extraction?: CompilerExtractionField[];
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

/** The one reserved tool name `transferCallTool()` always uses (`packages/templates/src/shared/tools.ts`) — never a real HTTP `/voice-tools` call, a native Retell transfer-call node instead (see `TransferCallNode` below). */
const TRANSFER_CALL_TOOL_NAME = "transfer_call";
/** The shared take-message tool every vertical declares (`packages/templates/src/shared/tools.ts#takeMessageTool`) — granted, compiler-side only, to a transfer-only state when no `transferNumber` is configured (CALL-4's spoken-fallback design, this file's header). */
const TAKE_MESSAGE_TOOL_NAME = "take_message";

/**
 * CALL-9 (docs/BUILD_NOTES.md): prepended to the START state/node of every
 * compile target, right after `disclosure_line` — the exact same "known-
 * safe compile-time-constant text ahead of the state's own authored
 * prompt" pattern `disclosure_line` itself already uses. `voice-inbound`
 * (a real call) and `api-admin-run-agent-tests`'s batch-test harness (a
 * simulated one, via its own `heyloo_test_caller_number` dynamic variable —
 * `voice-tools/context.ts`) both ALWAYS set the `{{caller_recent_context}}`
 * dynamic variable Retell substitutes here to a real sentence, never omit
 * it (`_shared/inbound-dynamic-variables.ts#resolveCallerRecentContext`'s
 * own doc comment) — RETELL-VERIFIED live (docs.retellai.com/build/
 * dynamic-variables, docs/VERIFY.md CALL-9) that Retell only does literal
 * `{{name}}` substitution, so an always-set variable is required here to
 * avoid ever leaving a raw unresolved placeholder in the model's prompt.
 *
 * Before this task, `caller_recent_context` was assembled and sent on
 * every `/voice-inbound` response but never referenced by `{{}}` anywhere
 * in any compiled template — completely inert, for a real returning caller
 * too. This is the actual fix, not just the data-plumbing half.
 */
const CALLER_RECENT_CONTEXT_INSTRUCTION =
  "Caller history: {{caller_recent_context}} If this indicates a known returning caller, " +
  "acknowledge that naturally early in the call (e.g. greet them by the first name given, if " +
  "any) and don't ask them to restate information already on file — otherwise proceed as a " +
  "normal first-time caller.";

/**
 * QA-HOT (docs/BUILD_NOTES.md): the SAME always-set-dynamic-variable
 * prepend pattern as `CALLER_RECENT_CONTEXT_INSTRUCTION` above, for
 * `tenants.language_config.primary` (`{{language}}`, already assembled and
 * sent on every `/voice-inbound` response by
 * `_shared/inbound-dynamic-variables.ts` — CALL-9's own header on that
 * file's `InboundTenantConfig.languagePrimary` field) but, before this
 * task, never once referenced by `{{}}` anywhere in any compiled
 * template — the exact same "assembled but completely inert" gap
 * `caller_recent_context` had before CALL-9, this time for the tenant's
 * configured spoken-call language (FRONTEND_SPEC.md §6.6 "Agent →
 * Language", `packages/canonical-types/src/schemas/agent-language.ts`).
 * `{{language}}` is Retell's own literal-substitution dynamic variable
 * (RETELL-VERIFIED, same mechanism CALL-9 already confirmed for
 * `{{caller_recent_context}}`/`{{transfer_number}}`) and resolves to the
 * tenant's ISO 639-1 short code (`"en"`/`"es"` — `AGENT_LANGUAGES`), so
 * this instruction spells out what those two values mean rather than
 * assuming the model infers it.
 *
 * NOT the whole fix: Retell's own agent-level `language` field (governs
 * STT locale/default TTS voice, RETELL-VERIFIED docs.retellai.com/
 * api-references/create-agent 2026-09-23 — supported values include
 * `es-419`/`es-ES`, no bare `es-US`) is set by the PROVISIONING layer
 * (`_shared/provisioning/compile-and-publish.ts`'s `createAgent` call,
 * via `_shared/inbound-dynamic-variables.ts#resolveRetellAgentLanguage`),
 * never by this compiler — this instruction only governs what the model
 * SAYS once Retell has already transcribed the caller's speech
 * correctly. Both halves are required for a genuinely bilingual call;
 * see docs/BUILD_NOTES.md QA-HOT for the full gap analysis (tracked
 * pre-existing as SYSTEM_DESIGN §14 gap G12, "bilingual agent support").
 */
const LANGUAGE_INSTRUCTION =
  'Configured call language: {{language}} (an ISO 639-1 code — "en" = English, ' +
  '"es" = Spanish). Conduct this entire call in that language by default — greeting, the ' +
  "AI/recording disclosure above, every question, and every confirmation — using natural, " +
  "conversational speech, not a literal translation. If the caller speaks a different language " +
  "than the configured one, switch to match the caller instead of insisting on the configured " +
  "language.";

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
  // CALL-2 (docs/BUILD_NOTES.md): RETELL-VERIFIED live 2026-09-20
  // (docs.retellai.com/build/conversation-flow/overview,
  // /api-references/create-conversation-flow) — VERIFY-8's prior
  // resolution was half right and half wrong. Right: `tool_ids` is not a
  // field on a plain `"conversation"` node. WRONG conclusion drawn from
  // that: dropping `tool_ids` entirely rather than switching a tool-
  // backed state to the node type that DOES support it. The docs are
  // explicit and load-bearing here: "Conversation nodes do not use tools /
  // functions" — a `"conversation"` node's LLM can NEVER invoke a tool,
  // full stop, no matter what the flow's top-level `tools[]` contains or
  // what the node's own prompt text says to do. `"subagent"` is the node
  // type built for exactly this ("dialogue with tool calling") — same
  // `instruction`/`edges`/`global_node_setting` shape a `"conversation"`
  // node has, plus `tool_ids`. This was a real, live, silent bug: EVERY
  // node this compiler ever emitted was `"conversation"`, so no
  // conversation-flow agent this platform has ever compiled could call
  // ANY tool — confirmed against a real batch-test transcript
  // (`docs/BUILD_NOTES.md` CALL-2): the agent verbatim says "I don't have
  // the ability to see availability directly," then hallucinates a
  // booking confirmation instead of ever calling `create_booking`, then
  // loops repeating that confirmation until Retell's loop-detector aborts
  // the call — exactly the "Ending the conversation early as there might
  // be a loop" result CALL-1 saw on 7/8 scenarios, not (only) the
  // call-context-resolution gap CALL-1 traced it to. SYSTEM_DESIGN §4.1's
  // own stated design for conversation_flow is "tool-backed nodes only" —
  // this fixes the compiler to actually implement that, matching what
  // `compileMultiPrompt` below already does per-state via the same
  // `state.allowed_tools` field.
  type: "conversation" | "subagent";
  name: string;
  instruction: { type: "prompt"; text: string };
  edges: Array<{
    id: string;
    destination_node_id: string;
    transition_condition: { type: "prompt"; prompt: string };
  }>;
  // `global_node_setting: {condition}` — confirmed an object with a
  // REQUIRED `condition` string (VERIFY-8). See
  // packages/adapters/retell/src/compiler/types.ts for the full
  // resolved-shape writeup (this file is a deliberate duplicate of that
  // package's compiler, kept in sync — BUILD_NOTES T4/T3).
  global_node_setting?: { condition: string };
  /** Only present (and only valid) when `type === "subagent"` — the
   * flow-level `tools[].tool_id` values (== `tool.name`, CALL-1's
   * `tool_id: tool.name` convention) this node's LLM may call. */
  tool_ids?: string[];
}

/**
 * CALL-2 (docs/BUILD_NOTES.md): RETELL-VERIFIED live 2026-09-20
 * (retell-typescript-sdk's `EndNode` interface, `src/resources/
 * conversation-flow.ts` — docs.retellai.com/build/conversation-flow/node
 * corroborates the field names but not a full schema on its own). A real,
 * live-confirmed bug this fixes: `template.states[].is_terminal` was
 * NEVER read by this compiler (only referenced in test fixtures/other
 * packages) — an `is_terminal` state compiled to an ordinary
 * conversation/subagent node with no edge onward, so once the model
 * finished that state (e.g. `confirm_booking` right after a successful
 * `create_booking`) there was nowhere for the flow to go: confirmed live,
 * the model just kept re-confirming/re-calling the same tool turn after
 * turn until Retell's own test-run timeout, never a clean call end.
 */
interface EndNode {
  id: string;
  type: "end";
  name?: string;
  speak_during_execution?: boolean;
  instruction?: { type: "prompt"; text: string };
  // CALL-4: shared by the same mechanism as `ConversationNode.
  // global_node_setting` (RETELL-VERIFIED against the real retell-sdk
  // TypeScript source, `node_modules/retell-sdk/src/resources/
  // conversation-flow.ts` — `ConversationFlowCreateParams.EndNode.
  // global_node_setting?: EndNode.GlobalNodeSetting` — every node type this
  // compiler emits carries this same optional field). Used by the generic
  // wrap-up node below so it's reachable from anywhere in the flow, not
  // just from a state with an authored edge onto it.
  global_node_setting?: { condition: string };
}

/**
/**
 * CALL-4 (docs/BUILD_NOTES.md): RETELL-VERIFIED field-for-field against the
 * real retell-sdk TypeScript source (`node_modules/retell-sdk/src/
 * resources/conversation-flow.ts`, `ConversationFlowCreateParams.
 * TransferCallNode` — also cross-checked against docs.retellai.com/
 * api-references/create-conversation-flow, both fetched 2026-09-20, see
 * docs/VERIFY.md). `edge` is a SINGULAR required field (not an array) —
 * the "transfer failed" fallback path only; a successful transfer bridges
 * the call away from this flow entirely, no further routing needed here.
 *
 * PUBLISH-1 (docs/BUILD_NOTES.md): `transfer_destination.number` accepts
 * either a literal E.164 string or a `{{dynamic_variable}}` placeholder per
 * the SDK's own doc comment — RE-VERIFIED live 2026-09-21 against BOTH
 * `docs.retellai.com/api-references/create-conversation-flow` (the field's
 * own description literally reads "The number to transfer to in E.164
 * format or a dynamic variable like {{transfer_number}}.") and
 * `docs.retellai.com/build/dynamic-variables` (confirms dynamic variables
 * substitute into transfer destinations, and that an inbound call's
 * variables come from the Inbound Call Webhook — exactly `voice-inbound`'s
 * own response, `_shared/inbound-dynamic-variables.ts`). CALL-4 originally
 * baked the LITERAL number in at compile time instead, for a simpler
 * compile-time guarantee — but that is exactly what left a tenant's
 * transfer-number change dead until the next republish (ONBOARD-1's
 * live-observed gap, docs/BUILD_NOTES.md). This compiler now ALWAYS bakes
 * the literal `{{transfer_number}}` TOKEN (never a real number) into this
 * node — the live value is substituted by Retell per call, from the
 * dynamic variable `voice-inbound`/the batch-test harness already send
 * when `agent_configs.transfer_number` is set. G6 ("transfer_call
 * destinations tenant-config only") still holds: the ONLY source that ever
 * populates `transfer_number` is `agent_configs.transfer_number`, read
 * fresh per call — never caller/model input. See `compileConversationFlow`'s
 * transfer-only handling below: the no-number-configured fallback is now a
 * RUNTIME edge decision (whether the live `transfer_number` value is
 * non-empty), not a compile-time branch.
 */
interface TransferCallNode {
  id: string;
  type: "transfer_call";
  name: string;
  transfer_destination: { type: "predefined"; number: string };
  // Warm transfer — SYSTEM_DESIGN §4.5: "warm transfers always carry a
  // context summary". `{type: "warm_transfer"}` alone is a complete, valid
  // value (every other `TransferOptionWarmTransfer` field is optional,
  // RETELL-VERIFIED against the real SDK source).
  transfer_option: { type: "warm_transfer" };
  edge: {
    id: string;
    destination_node_id: string;
    transition_condition: { type: "prompt"; prompt: string };
  };
  global_node_setting?: { condition: string };
  /** Unused by this compiler (never the start node, see `compileConversationFlow`'s guard) — declared only so `firstTurnText`'s `.instruction?.text` narrows across the whole node union without a discriminant check. RETELL-VERIFIED present on the real node (`"What to say when transferring the call, only used when speak during execution"`). */
  instruction?: { type: "prompt"; text: string };
}

export interface ConversationFlowBody {
  start_node_id: string;
  // REQUIRED on ConversationFlowCreateParams (RETELL-VERIFY, confirmed via
  // retell-typescript-sdk) — always "agent": every template opens with the
  // agent's own greeting/disclosure line, never a user-speaks-first flow.
  start_speaker: "agent";
  nodes: (ConversationNode | EndNode | TransferCallNode)[];
  tools: FunctionTool[];
  global_prompt?: string;
}

export interface CompileConversationFlowOptions {
  /**
   * PUBLISH-1 (docs/BUILD_NOTES.md): no longer read by this file. Before
   * PUBLISH-1, `agent_configs.transfer_number` was resolved by the CALLER
   * and baked into the compiled flow as a literal at compile time — so a
   * tenant's later transfer-number change never took effect without a
   * republish (ONBOARD-1's live-observed gap). Every transfer-only state
   * now ALWAYS compiles the same way, referencing the live
   * `{{transfer_number}}` dynamic variable and deciding transfer-vs-
   * fallback at RUNTIME instead (see `TransferCallNode`'s own doc comment
   * and `compileConversationFlow`'s transfer-only handling below) — so
   * this option can never again change the compiled output. Kept only so
   * every existing 3-arg call site (`compile-and-publish.ts`,
   * `admin/handler.ts`, this file's own tests) keeps compiling unchanged;
   * a future cleanup can drop it once those call sites stop passing it.
   */
  transferNumber?: string | null;
}

function isTransferOnlyState(state: CompilerAgentState): boolean {
  return state.allowed_tools.length === 1 && state.allowed_tools[0] === TRANSFER_CALL_TOOL_NAME;
}

/** PUBLISH-1: the literal string always baked into a compiled
 * `TransferCallNode.transfer_destination.number` / `MultiPromptTransferCallTool.
 * transfer_destination.number` — Retell substitutes it per call from the
 * live `transfer_number` dynamic variable (RETELL-VERIFIED,
 * docs.retellai.com/api-references/create-conversation-flow +
 * docs.retellai.com/build/dynamic-variables, 2026-09-21, see
 * `TransferCallNode`'s own doc comment above). Never a real number. */
const TRANSFER_NUMBER_TOKEN = "{{transfer_number}}";

const NO_TRANSFER_FALLBACK_INSTRUCTION =
  "No live transfer line is configured for this business right now. Once, clearly and " +
  "warmly, say so and offer to take down their name, phone number, and a short message so " +
  "the team can call them back — never repeat that same apology/offer a third time. If they " +
  "give a callback number, call take_message with it (fold in whatever they've already told " +
  "you) and let them know someone will call back soon, then the call is done. If they keep " +
  "insisting on a transfer or won't give a number after you've offered twice, don't keep " +
  "repeating yourself: calmly acknowledge you can't do more right now and that's the end of " +
  "what you can help with today — the call is done either way.";

/** PUBLISH-1: instruction for `compileConversationFlow`'s transfer-only
 * router node (the state's own id) — a genuine runtime decision, not the
 * compile-time either/or CALL-4 originally used. The router's own
 * `hasTransferEdge` (below) carries the SAME "is a live number available"
 * condition structurally; this text is what the model actually says on
 * whichever branch the live per-call `transfer_number` dynamic variable
 * puts it on. */
const TRANSFER_ROUTER_INSTRUCTION =
  "The live transfer number for this business right now is: {{transfer_number}}. If that is a " +
  "real, non-empty phone number, say once, briefly and warmly, that you're connecting them to " +
  "a team member now — do not call take_message in that case. If it is empty/blank: " +
  NO_TRANSFER_FALLBACK_INSTRUCTION;

/** CALL-7 (docs/BUILD_NOTES.md): `compileMultiPrompt`/`compileSinglePrompt`
 * append this onto `NO_TRANSFER_FALLBACK_INSTRUCTION` above (conversation_
 * flow never does — it has no `end_call` tool/concept, it forces the exit
 * structurally via a dedicated edge instead, CALL-4). Without this, a real
 * batch-test transcript showed the model still gently re-offering to take a
 * message turn after turn against an adversarial caller who keeps refusing
 * to leave one — technically obeying "don't repeat the same apology" (each
 * turn's wording genuinely varied) while never actually calling `end_call`,
 * which still reads as a loop to Retell's own detector. Explicit and
 * unconditional: hang up yourself, don't wait for the caller's agreement. */
const NO_TRANSFER_FALLBACK_END_CALL_SUFFIX =
  " Once you've offered to take a message twice (whether or not they gave you a callback " +
  "number), you MUST call the end_call tool yourself right then, no matter what the caller " +
  "says next — even if they explicitly ask you not to hang up, keep insisting, or repeat the " +
  "same demand a third time. Do not wait for the caller to agree or say goodbye first, do not " +
  "send them back through the same offer again, and do not let them talk you out of ending " +
  "the call once you've reached this point — there is nothing more you can do for them on " +
  "this call, and continuing to repeat yourself helps no one.";

/** PUBLISH-1: `compileMultiPrompt`/`compileSinglePrompt`'s transfer-only
 * state prompt, ALWAYS appended now — the `MultiPromptTransferCallTool`/
 * `general_tools` transfer_call entry is always granted (destination the
 * literal `{{transfer_number}}` token) alongside `take_message`
 * (structurally available from every state via `general_tools`, CALL-8),
 * so the model itself picks the right one per call from the live dynamic
 * variable's actual value — a genuine runtime decision, not the
 * compile-time either/or CALL-4/CALL-7 originally used. */
const TRANSFER_TOOL_OR_FALLBACK_INSTRUCTION =
  "The live transfer number for this business right now is: {{transfer_number}}. If that is a " +
  "real, non-empty phone number, call transfer_call to connect the caller now — do not " +
  "apologize or offer to take a message in that case. If it is empty/blank: " +
  NO_TRANSFER_FALLBACK_INSTRUCTION;

function compileConversationFlow(
  template: CompilerAgentTemplate,
  toolWebhookUrl: string,
  options: CompileConversationFlowOptions = {},
): ConversationFlowBody {
  // PUBLISH-1: `options.transferNumber` no longer affects the compiled
  // output at all (see `CompileConversationFlowOptions`'s own doc comment)
  // — referenced here only so existing 3-arg call sites keep compiling
  // under `noUnusedParameters`.
  void options.transferNumber;
  // transfer_call is never a real HTTP `/voice-tools` call (it compiles to
  // a native TransferCallNode below) — excluded from the flow's top-level
  // custom-function tools list so Retell never sees a bogus webhook tool
  // named "transfer_call" (CALL-4 fix; previously included unfiltered).
  const tools = toolsFor(template, toolWebhookUrl).filter(
    (t) => t.name !== TRANSFER_CALL_TOOL_NAME,
  );

  const toolsByName = new Map(tools.map((t) => [t.name, t]));

  const nodesById = new Map<string, ConversationNode | TransferCallNode>();
  for (const state of template.states) {
    const transferOnly = isTransferOnlyState(state);

    // PUBLISH-1 (docs/BUILD_NOTES.md ONBOARD-1/PUBLISH-1): a transfer-only
    // state now ALWAYS compiles to TWO nodes — a router (this state's own
    // id, unchanged so every existing incoming edge still resolves) and a
    // dedicated `${state.id}__transfer` TransferCallNode whose destination
    // is the literal `{{transfer_number}}` TOKEN (substituted by Retell
    // per call from the live dynamic variable, never a value baked in
    // here) — instead of the compiler deciding which ONE of those to emit
    // from `agent_configs.transfer_number` at compile time. The router's
    // own edge to the transfer node is itself evaluated per call, against
    // the LIVE dynamic-variable value, so a tenant's transfer-number
    // change (or removal) takes effect on the very next call, no
    // republish needed — see `TransferCallNode`'s doc comment above.
    if (transferOnly) {
      const transferNodeId = `${state.id}__transfer`;
      nodesById.set(transferNodeId, {
        id: transferNodeId,
        type: "transfer_call",
        name: `${state.name} — live transfer`,
        transfer_destination: { type: "predefined", number: TRANSFER_NUMBER_TOKEN },
        transfer_option: { type: "warm_transfer" },
        // Destination filled in once the is_terminal end-node pass below
        // creates `${state.id}__end` — every shipped transferOnly state is
        // `is_terminal: true` (transferToHumanState()), so this always
        // resolves; defensively falls back to the router node itself (a
        // no-op edge Retell will reject loudly rather than silently drop)
        // if a future template ever violates that assumption.
        edge: {
          id: `${state.id}_transfer_failed`,
          destination_node_id: state.is_terminal ? `${state.id}__end` : state.id,
          // PUBLISH-1 (docs/BUILD_NOTES.md): RETELL-VERIFIED live 2026-09-21
          // — root cause of the live `retell_flow_create_failed` error
          // (ONBOARD-1's own finding, re-fetched from docs.retellai.com/
          // api-references/create-conversation-flow this session): a
          // TransferCallNode's `edge.transition_condition` is NOT free
          // text like every other node's edges — its JSON schema is
          // `{type: {enum: ["prompt"]}, prompt: {enum: ["Transfer
          // failed"]}}`, i.e. `prompt` MUST be the literal string
          // "Transfer failed", nothing else. CALL-4 never caught this
          // (its own test tenant never had a transfer number configured,
          // so this node type was never actually sent to Retell before
          // ONBOARD-1 did, live, by accident).
          transition_condition: { type: "prompt", prompt: "Transfer failed" },
        },
      });
    }

    // Only tool_ids Retell actually knows about (defensive — a state
    // authoring bug referencing a name absent from template.tools would
    // otherwise produce a tool_ids entry Retell rejects outright). The
    // router for a transfer-only state is ALWAYS granted take_message too
    // (needed whenever the live transfer_number turns out to be empty).
    const requestedTools = transferOnly ? [TAKE_MESSAGE_TOOL_NAME] : (state.allowed_tools ?? []);
    const toolIds = requestedTools.filter((name) => toolsByName.has(name));
    // PUBLISH-1: the router's edge onto the dedicated transfer node, taken
    // only when a live transfer number is actually available this call —
    // a genuine runtime (per-call, model-evaluated) branch, not a
    // compile-time one.
    const hasTransferEdge = transferOnly
      ? [
          {
            id: `edge_${state.id}_has_transfer`,
            destination_node_id: `${state.id}__transfer`,
            transition_condition: {
              type: "prompt" as const,
              prompt:
                "The transfer_number value for this call ({{transfer_number}}) is a real, " +
                "non-empty phone number — a live transfer number is available for this " +
                "business right now.",
            },
          },
        ]
      : [];
    // CALL-4 live-iteration fix: the generic is_terminal end-edge below
    // ("the caller has nothing further to discuss") requires the CALLER to
    // drop the topic — an adversarial caller who keeps repeating the same
    // transfer demand after the agent has already clearly declined twice
    // never satisfies that wording, so the call stalls at this node and
    // Retell's own loop-detector aborts it (live-confirmed:
    // `docs/BUILD_NOTES.md` CALL-4). This fallback node gets its own EXTRA
    // edge to that same end node whose condition is satisfied by the
    // AGENT's own turn instead — it doesn't need the caller's agreement.
    const fallbackDoneEdge =
      transferOnly && state.is_terminal
        ? [
            {
              id: `edge_${state.id}_fallback_done`,
              destination_node_id: `${state.id}__end`,
              transition_condition: {
                type: "prompt" as const,
                prompt:
                  "you have already clearly told the caller no live transfer is available and " +
                  "offered to take a message at least once — end here even if the caller keeps " +
                  "repeating the same request",
              },
            },
          ]
        : [];
    nodesById.set(state.id, {
      id: state.id,
      type: toolIds.length > 0 ? "subagent" : "conversation",
      name: state.name,
      instruction: {
        type: "prompt",
        text: transferOnly ? TRANSFER_ROUTER_INSTRUCTION : state.prompt_fragment,
      },
      edges: [...hasTransferEdge, ...fallbackDoneEdge],
      ...(toolIds.length > 0 ? { tool_ids: toolIds } : {}),
    });
  }

  for (const [index, transition] of template.transitions.entries()) {
    const fromNode = nodesById.get(transition.from);
    // transfer_call nodes have no `edges` array (a single required `edge`
    // only, set above) — no shipped template authors an outgoing
    // transition from a transfer-only state today (it's always
    // is_terminal), but guard it the same way the is_terminal pass below
    // does rather than throw.
    if (!fromNode || fromNode.type === "transfer_call" || !nodesById.has(transition.to)) continue;
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
      if (!fromNode || fromNode.type === "transfer_call") continue;
      // CALL-7: same dedup guard as `compileMultiPrompt`'s live-confirmed
      // fix below (see that function's own doc comment) — not currently
      // reachable by any shipped template (every `global_intents` entry
      // today uses `reachable_from: "any"`, handled by the branch above
      // instead), kept in sync defensively so an explicit-list global
      // intent never reintroduces the same duplicate-destination class of
      // bug if one is ever authored.
      if (fromNode.edges.some((e) => e.destination_node_id === globalIntent.target_state)) {
        continue;
      }
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
    // The start state is never a transfer-only state in any shipped
    // template (see this file's own compileTemplate doc comment history /
    // packages/adapters/retell's identical documented assumption) — guard
    // defensively rather than assume.
    if (startNode && startNode.type !== "transfer_call") {
      startNode.instruction.text = `${template.disclosure_line}\n\n${LANGUAGE_INSTRUCTION}\n\n${CALLER_RECENT_CONTEXT_INSTRUCTION}\n\n${startNode.instruction.text}`;
    }
  }

  // CALL-2: every `is_terminal` state gets its own `end` node plus one
  // edge onto it, so the flow actually has somewhere to go once that
  // state's business is done — see `EndNode`'s own doc comment for the
  // live bug this closes (no edge onward -> the model stalls, repeating
  // the same turn/tool call forever instead of ending the call).
  const endNodes: EndNode[] = [];
  for (const state of template.states) {
    if (!state.is_terminal) continue;
    const fromNode = nodesById.get(state.id);
    if (!fromNode) continue;
    const endNodeId = `${state.id}__end`;
    endNodes.push({
      id: endNodeId,
      type: "end",
      name: `${state.name} — end call`,
      speak_during_execution: true,
      instruction: {
        type: "prompt",
        text: "Thank the caller, confirm there's nothing else you can help with, and say a warm goodbye.",
      },
    });
    // A transfer_call node's own `edge` (set above) already targets this
    // exact end-node id — nothing further to wire onto it, and it has no
    // `.edges` array to push onto anyway.
    if (fromNode.type === "transfer_call") continue;
    fromNode.edges.push({
      id: `edge_${state.id}_end`,
      destination_node_id: endNodeId,
      transition_condition: {
        type: "prompt",
        prompt: "this state's business is fully done and the caller has nothing further to discuss",
      },
    });
  }

  // CALL-4 (docs/BUILD_NOTES.md "FAQ-only calls never hang up"): a single
  // generic wrap-up escape, reachable from ANYWHERE in the flow via
  // Retell's global-node mechanism (the same mechanism every authored
  // `global_intents` "reachable_from: any" entry already uses) — not tied
  // to any one vertical's state ids. Two nodes, matching the task's own
  // "Is there anything else I can help with?" -> no -> end shape: a
  // conversation node asks the question and either loops back to the
  // flow's start node (the caller has another request) or proceeds to a
  // true end node (they don't). This is what closes the gap `is_terminal`
  // end-nodes above don't cover: a state like `greeting` that answers an
  // FAQ inline and is never itself `is_terminal` (it's also the booking
  // entry point, so it can't always be).
  const WRAP_UP_NODE_ID = "__wrap_up";
  const WRAP_UP_END_NODE_ID = "__wrap_up_end";
  const wrapUpNode: ConversationNode = {
    id: WRAP_UP_NODE_ID,
    type: "conversation",
    name: "Wrap-up",
    instruction: {
      type: "prompt",
      text: 'Ask the caller: "Is there anything else I can help with?" and wait for their answer.',
    },
    edges: [
      {
        id: "edge_wrap_up_to_end",
        destination_node_id: WRAP_UP_END_NODE_ID,
        transition_condition: {
          type: "prompt",
          prompt:
            "The caller says no, they're all set, or otherwise indicates they have nothing further",
        },
      },
      {
        id: "edge_wrap_up_to_start",
        destination_node_id: startNodeId,
        transition_condition: {
          type: "prompt",
          prompt: "The caller says yes and has another request or question",
        },
      },
    ],
    global_node_setting: {
      // CALL-7 (docs/BUILD_NOTES.md): live-confirmed gap — the original
      // condition only covered "a request was just answered", so a caller
      // who never states any business request at all (e.g. asks only
      // "are you an AI?" and then says goodbye without ever booking/
      // asking an FAQ) had no matching edge anywhere in the flow. With
      // nowhere to go, the model just re-rendered the start node's own
      // instruction (disclosure line included) turn after turn — a real,
      // visible repeated-disclosure-line loop, not simulator noise,
      // confirmed via a live transcript that settled "Ending the
      // conversation early as there might be a loop." Widened to also
      // cover the caller saying goodbye / indicating they're done with
      // NOTHING resolved yet, not only after something was.
      condition:
        "The caller's current question or request has just been fully answered or handled " +
        "(for example an FAQ about hours or pricing) and nothing else in this call is actively " +
        "in progress, so it's a natural moment to check whether they need anything else; OR the " +
        "caller says goodbye, thanks you, or otherwise indicates they're done with the call even " +
        "though nothing was actually resolved yet (for example they declined to book or ask " +
        "anything after the greeting).",
    },
  };
  const wrapUpEndNode: EndNode = {
    id: WRAP_UP_END_NODE_ID,
    type: "end",
    name: "Wrap-up — end call",
    speak_during_execution: true,
    instruction: { type: "prompt", text: "Thank the caller and say a warm goodbye." },
  };

  const body: ConversationFlowBody = {
    start_node_id: startNodeId,
    start_speaker: "agent",
    nodes: [...nodesById.values(), ...endNodes, wrapUpNode, wrapUpEndNode],
    tools,
  };
  if (template.system_prompt) body.global_prompt = template.system_prompt;
  return body;
}

// ---------------------------------------------------------------------
// multi_prompt
// ---------------------------------------------------------------------

/** CALL-7 (docs/BUILD_NOTES.md): the same native-transfer-tool design
 * `compileConversationFlow`'s `TransferCallNode` already uses (RETELL-
 * VERIFIED against the real retell-sdk TypeScript source's
 * `LlmCreateParams.TransferCallTool`, which shares this exact shape with
 * a Retell LLM's per-state `tools`/`general_tools`) — a multi_prompt
 * state's tool-call slot, not a node. */
interface MultiPromptTransferCallTool {
  type: "transfer_call";
  name: string;
  description?: string | undefined;
  transfer_destination: { type: "predefined"; number: string };
  transfer_option: { type: "warm_transfer" };
}

interface MultiPromptState {
  name: string;
  state_prompt: string;
  edges: Array<{ destination_state_name: string; description: string }>;
  tools: (FunctionTool | MultiPromptTransferCallTool)[];
}

interface EndCallTool {
  type: "end_call";
  name: string;
  description?: string;
}

export interface MultiPromptBody {
  general_prompt: string;
  starting_state: string;
  states: MultiPromptState[];
  /** CALL-7 (docs/BUILD_NOTES.md): RETELL-VERIFIED live (docs.retellai.com/
   * build/single-multi-prompt/end-call, corroborated by the real retell-sdk
   * TypeScript source's `LlmCreateParams.EndCallTool`) — a Retell LLM
   * response engine (single/multi-prompt) NEVER ends a call on its own; "By
   * default, the agent won't end the call automatically" — it must be
   * explicitly granted a `type: "end_call"` tool. This was missing
   * ENTIRELY from every multi_prompt template this platform has ever
   * compiled (`legal`, `real_estate`) — live-confirmed root cause of a 0/6
   * batch-test run where EVERY scenario, including a plain FAQ call,
   * settled `error: "Ending the conversation early as there might be a
   * loop"`: once the conversation's business was done, the model had no
   * way to actually hang up, so it and the simulated caller kept trading
   * near-identical goodbye turns until Retell's own loop-detector aborted
   * the call. `general_tools` (not a per-state field) makes it callable
   * from every state, matching `general_prompt`'s own "no matter what
   * state" semantics.
   *
   * CALL-8 (docs/BUILD_PLAN.md): also where `take_message` is now added
   * when the template declares it (RETELL-VERIFIED: `general_tools`
   * accepts any `Tool` variant, including `type: "custom"`, not just
   * `end_call` — docs.retellai.com/api-references/create-retell-llm,
   * confirmed 2026-09-21) — see `compileMultiPrompt`'s own comment on why.
   */
  general_tools: (EndCallTool | FunctionTool)[];
}

/** The general_prompt instruction that makes the `general_tools` end_call
 * tool (see `MultiPromptBody#general_tools`'s own doc comment) actually get
 * used — granting the tool alone doesn't tell the model WHEN to call it,
 * and an ungranted-but-unused tool leaves the exact same "never actually
 * hangs up" bug. Appended to every multi_prompt template's own
 * `system_prompt`, independent of any per-vertical authored content. */
const END_CALL_INSTRUCTION =
  "\n\nWhen the caller's request has been fully handled and they have nothing further to " +
  "discuss (they say goodbye, thank you, that's all, or similar, or you have already clearly " +
  "wrapped up the call), say a warm goodbye and then call the end_call tool to hang up. Never " +
  "just stop responding or repeat the same goodbye more than once — always end the call with " +
  "this tool once you've said goodbye.\n\n" +
  // CALL-8 (docs/BUILD_PLAN.md): live-observed real bug — a multi_prompt
  // template's own open, model-mediated conversation (by design, e.g.
  // legal's "open empathetic discovery a rigid graph would flatten") can
  // rush through several remaining questions in one turn, thank the caller,
  // and call end_call WITHOUT ever having called the tool that actually
  // records the call — the tool call Retell's own transcript-relevance
  // judge never checks for, so the call still grades "pass" even though
  // nothing was ever saved. This is a general risk for any multi_prompt/
  // single_prompt vertical, not specific to one, so it belongs here at the
  // compiler level rather than authored once per vertical.
  "Before you say goodbye or call end_call: if this call was ABOUT booking an appointment, " +
  "placing an order, or leaving a message/intake for the business to follow up on, you must " +
  "have ALREADY called the tool that actually records that (create_booking, create_order, or " +
  "take_message) earlier in this same call — never promise to record something, or act as if " +
  "you have, without having actually called that tool. If you realize you have not yet called " +
  "it, call it now (even with an incomplete set of fields — something recorded is always better " +
  "than nothing) before ending the call. This never applies to a call that was ONLY an FAQ " +
  "question, a transfer, or a cancellation with nothing new to record.";

function compileMultiPrompt(
  template: CompilerAgentTemplate,
  toolWebhookUrl: string,
  options: CompileConversationFlowOptions = {},
): MultiPromptBody {
  // PUBLISH-1: `options.transferNumber` no longer affects the compiled
  // output (see `CompileConversationFlowOptions`'s doc comment) —
  // referenced only so existing 3-arg call sites keep compiling under
  // `noUnusedParameters`.
  void options.transferNumber;
  // CALL-7 live-confirmed bug (docs/BUILD_NOTES.md): unlike
  // `compileConversationFlow` (CALL-4), this function NEVER special-cased
  // `transfer_call` — it compiled to an ordinary custom `/voice-tools`
  // webhook call, an unrecognized tool name that dispatcher (`voice-tools/
  // handler.ts`) always answers with the generic `fallbackEnvelope()`. Live
  // transcript evidence: the model called it 4 times in a row against an
  // insistent caller, each time getting back `{"result":{"fallback":true,
  // ...}}`, repeating "I'm transferring you now" each time — the exact
  // "Ending the conversation early as there might be a loop" failure mode.
  // Fixed identically to `compileConversationFlow`: a native
  // `MultiPromptTransferCallTool` is ALWAYS granted now (PUBLISH-1:
  // destination is the literal `{{transfer_number}}` token, resolved by
  // Retell per call from the live dynamic variable — never a compile-time
  // either/or), alongside an instruction covering the honest take_message-
  // based spoken fallback for whenever the live value turns out empty.
  const transferToolDescription = template.tools.find(
    (t) => t.name === TRANSFER_CALL_TOOL_NAME,
  )?.description;
  // CALL-8 (docs/BUILD_PLAN.md): `take_message` is filtered out of the
  // regular per-state tool pool the SAME way `transfer_call` already is —
  // it moves to `general_tools` below (RETELL-VERIFIED: `general_tools`
  // accepts a `type: "custom"` entry, not just `end_call`) so it's
  // structurally callable from EVERY state, not just whichever ones happen
  // to list it in their own `allowed_tools`. Root cause this closes,
  // live-observed: a caller who front-loads later-state information (e.g.
  // legal's urgency/referral-source, volunteered early) leads the model to
  // consider intake done and call `end_call` directly from whichever
  // EARLIER state it's still in — a state that, before this fix, may never
  // have granted `take_message` at all (only the terminal/final state did),
  // silently losing the intake even though Retell's own transcript-
  // relevance judge still scored the call "pass".
  const takeMessageTool = template.tools.find((t) => t.name === TAKE_MESSAGE_TOOL_NAME);
  const tools = toolsFor(template, toolWebhookUrl).filter(
    (t) => t.name !== TRANSFER_CALL_TOOL_NAME && t.name !== TAKE_MESSAGE_TOOL_NAME,
  );
  const toolsByName = new Map(tools.map((t) => [t.name, t]));

  const statesByName = new Map<string, MultiPromptState>();
  for (const state of template.states) {
    const transferOnly = isTransferOnlyState(state);

    // PUBLISH-1: a transfer-only state ALWAYS gets the native transfer_call
    // tool now (destination the literal `{{transfer_number}}` token — see
    // `TRANSFER_NUMBER_TOKEN`'s doc comment), never a compile-time either/
    // or — the model itself decides, per call, from the live dynamic
    // variable's actual value (`TRANSFER_TOOL_OR_FALLBACK_INSTRUCTION`).
    if (transferOnly) {
      statesByName.set(state.id, {
        name: state.id,
        state_prompt: `${state.prompt_fragment}\n\n${TRANSFER_TOOL_OR_FALLBACK_INSTRUCTION}${NO_TRANSFER_FALLBACK_END_CALL_SUFFIX}`,
        edges: [],
        tools: [
          {
            type: "transfer_call",
            name: TRANSFER_CALL_TOOL_NAME,
            description: transferToolDescription,
            transfer_destination: { type: "predefined", number: TRANSFER_NUMBER_TOKEN },
            transfer_option: { type: "warm_transfer" },
          },
        ],
      });
      continue;
    }

    const requestedTools = state.allowed_tools ?? [];
    statesByName.set(state.id, {
      name: state.id,
      state_prompt: state.prompt_fragment,
      edges: [],
      tools: requestedTools
        .map((t) => toolsByName.get(t))
        .filter((t): t is FunctionTool => t !== undefined),
    });
  }

  for (const transition of template.transitions) {
    const fromState = statesByName.get(transition.from);
    if (!fromState || !statesByName.has(transition.to)) continue;
    // CALL-7 live-confirmed bug (docs/BUILD_NOTES.md): Retell's
    // create-retell-llm rejects a multi_prompt state with two edges to the
    // SAME destination state ("Destination states must be unique for a
    // particular state, found duplicate destination state: <id>") —
    // confirmed via a real 400 against `legal`'s compiled flow. Guarded
    // here too (not just the global_intents loop below) in case a future
    // template ever authors two transitions with the same from/to.
    if (fromState.edges.some((e) => e.destination_state_name === transition.to)) continue;
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
      // CALL-7 (docs/BUILD_NOTES.md): the actual bug this session hit
      // live — a `reachable_from: "any"` global intent (e.g. legal's/
      // real_estate's "give_up" -> take_message_fallback) blindly added a
      // SECOND edge to a state that already had an authored `transitions`
      // edge to that exact same target (e.g. legal's own `greeting ->
      // take_message_fallback` on "after_hours_or_wants_to_leave_a_
      // message") — Retell's real 400 above, every time. A state having
      // multiple DIFFERENT reasons to reach the same destination is a
      // real, valid design (the caller can get there via either path);
      // only the destination itself needs to stay unique per Retell's own
      // constraint, so the two descriptions are never merged — the first
      // edge to claim a destination (authored transitions always run
      // first, above) simply wins, and every ADDITIONAL edge that would
      // have gone to the same already-covered destination is dropped as
      // structurally redundant to Retell either way.
      if (sourceState.edges.some((e) => e.destination_state_name === globalIntent.target_state)) {
        continue;
      }
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
      compiledStart.state_prompt = `${template.disclosure_line}\n\n${LANGUAGE_INSTRUCTION}\n\n${CALLER_RECENT_CONTEXT_INSTRUCTION}\n\n${compiledStart.state_prompt}`;
    }
  }

  return {
    general_prompt: (template.system_prompt ?? "") + END_CALL_INSTRUCTION,
    starting_state: startState?.id ?? "",
    states: [...statesByName.values()],
    general_tools: [
      {
        type: "end_call",
        name: "end_call",
        description: "End the call once it's fully wrapped up.",
      },
      // CALL-8: see this function's own comment above (`takeMessageTool`) —
      // present on every shipped template (`takeMessageTool()`,
      // `packages/templates/src/shared/tools.ts`), so this is effectively
      // unconditional in practice; the `undefined` guard is defensive only.
      ...(takeMessageTool
        ? [
            {
              type: "custom" as const,
              tool_id: takeMessageTool.name,
              name: takeMessageTool.name,
              description: takeMessageTool.description,
              url: toolWebhookUrl,
              parameters: takeMessageTool.parameters,
            },
          ]
        : []),
    ],
  };
}

// ---------------------------------------------------------------------
// single_prompt
// ---------------------------------------------------------------------

export interface SinglePromptBody {
  general_prompt: string;
  /** CALL-7: see `MultiPromptBody#general_tools`'s own doc comment — the
   * SAME "a Retell LLM response engine never ends a call on its own"
   * platform-wide gap applies equally to `single_prompt` (`generic`'s own
   * compile target) since it's the identical `create-retell-llm` resource,
   * just without `states` — always includes the `end_call` entry alongside
   * every authored custom-function tool. */
  general_tools: (FunctionTool | EndCallTool | MultiPromptTransferCallTool)[];
}

function compileSinglePrompt(
  template: CompilerAgentTemplate,
  toolWebhookUrl: string,
  options: CompileConversationFlowOptions = {},
): SinglePromptBody {
  // PUBLISH-1: `options.transferNumber` no longer affects the compiled
  // output (see `CompileConversationFlowOptions`'s doc comment) —
  // referenced only so existing 3-arg call sites keep compiling under
  // `noUnusedParameters`.
  void options.transferNumber;
  // CALL-7/PUBLISH-1: the SAME native-transfer-tool fix as
  // `compileMultiPrompt` above — single_prompt has no per-state tool
  // gating at all (every granted tool is always available, by this compile
  // target's own design, this file's header), so there's no one state to
  // special-case: exclude `transfer_call` from the ordinary custom-webhook
  // tools list entirely, and (PUBLISH-1) ALWAYS grant the native tool
  // (destination the literal `{{transfer_number}}` token) alongside an
  // honest "no live transfer" instruction section — the model picks
  // between them per call from the live dynamic variable's actual value.
  const transferToolDescription = template.tools.find(
    (t) => t.name === TRANSFER_CALL_TOOL_NAME,
  )?.description;
  const generalTools = toolsFor(template, toolWebhookUrl).filter(
    (t) => t.name !== TRANSFER_CALL_TOOL_NAME,
  );
  const hasTransferCallTool = template.tools.some((t) => t.name === TRANSFER_CALL_TOOL_NAME);

  const sections: string[] = [
    template.disclosure_line,
    LANGUAGE_INSTRUCTION,
    CALLER_RECENT_CONTEXT_INSTRUCTION,
  ];
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
  if (hasTransferCallTool) {
    sections.push(
      `## Transferring to a human\n${TRANSFER_TOOL_OR_FALLBACK_INSTRUCTION}${NO_TRANSFER_FALLBACK_END_CALL_SUFFIX}`,
    );
  }
  sections.push(`## Ending the call\n${END_CALL_INSTRUCTION.trim()}`);

  return {
    general_prompt: sections.join("\n\n"),
    general_tools: [
      ...generalTools,
      {
        type: "end_call",
        name: "end_call",
        description: "End the call once it's fully wrapped up.",
      },
      ...(hasTransferCallTool
        ? [
            {
              type: "transfer_call" as const,
              name: TRANSFER_CALL_TOOL_NAME,
              description: transferToolDescription,
              transfer_destination: { type: "predefined" as const, number: TRANSFER_NUMBER_TOKEN },
              transfer_option: { type: "warm_transfer" as const },
            },
          ]
        : []),
    ],
  };
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
      // The start node is always states[0] (compileConversationFlow), never
      // a synthetic `end`/`transfer_call`/wrap-up node — `instruction` is
      // only optional on those other union arms (declared there purely for
      // this lookup's type-checking, never populated by this compiler).
      const startNode = flow.body.nodes.find((n) => n.id === flow.body.start_node_id);
      return startNode?.instruction?.text ?? "";
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

/**
 * ANALYSIS-1: Retell's own `PostCallAnalysisData` shape (RETELL-VERIFIED,
 * docs.retellai.com/api-references/create-agent, 2026-09-21 — see
 * `docs/VERIFY.md`). Deliberately only the four `AnalysisData` custom-type
 * variants (`string`/`enum`/`boolean`/`number`) this platform's templates
 * actually declare — never the `"system-presets"` variant (`call_summary`/
 * `call_successful`/`user_sentiment`): those are ALREADY returned by every
 * Retell call unconditionally (`call_analysis.call_summary`/
 * `.call_successful`/`.user_sentiment`, confirmed via the same fetch and
 * already consumed as such by `voice-events/handler.ts#handleCallAnalyzed`
 * below), so redeclaring them here would be redundant, not additive.
 */
export interface PostCallAnalysisDataField {
  type: "string" | "enum" | "boolean" | "number";
  name: string;
  description: string;
  choices?: string[];
}

/**
 * ANALYSIS-1: turns every state's `extraction[]` (previously-dead data,
 * see `CompilerExtractionField`'s doc comment) into the flat, agent-level
 * `post_call_analysis_data` array Retell's `/create-agent` actually wants.
 * Dedupes by `field` name, first declaration across `template.states`
 * wins — `voice-events/handler.ts` already anticipated this exact rule in
 * its own doc comment (a same-named field declared differently by a later
 * state, e.g. a vertical-specific `urgency` enum, is intentionally
 * shadowed by the first, universally-consistent declaration, e.g.
 * `classification`/`outcome`/`follow_up_needed`, which every shipped
 * template declares identically on every state — see
 * `agent-template-seeds.ts`). Never throws: a state with no `extraction`
 * is skipped, and an entry missing `enum_values` for `type: "enum"` is
 * dropped rather than sent to Retell as a malformed field (mirrors this
 * compiler's established "silently skip a malformed reference" posture,
 * this file's own header comment).
 */
export function buildPostCallAnalysisData(
  template: CompilerAgentTemplate,
): PostCallAnalysisDataField[] {
  const byField = new Map<string, PostCallAnalysisDataField>();
  for (const state of template.states) {
    for (const entry of state.extraction ?? []) {
      if (!entry.field || byField.has(entry.field)) continue;
      const description =
        entry.description?.trim() || `Extracted value for the "${entry.field}" field.`;
      if (entry.type === "enum") {
        const choices = (entry.enum_values ?? []).filter((v) => typeof v === "string" && v);
        if (choices.length === 0) continue;
        byField.set(entry.field, { type: "enum", name: entry.field, description, choices });
        continue;
      }
      const type = entry.type === "text" ? "string" : entry.type;
      byField.set(entry.field, { type, name: entry.field, description });
    }
  }
  return [...byField.values()];
}

export interface CompiledTemplate {
  compileTarget: CompilerAgentTemplate["compile_target"];
  disclosureVerified: boolean;
  flow: CompiledFlowRequest;
  /** ANALYSIS-1: see `buildPostCallAnalysisData` above. */
  postCallAnalysisData: PostCallAnalysisDataField[];
}

export function compileTemplate(
  template: CompilerAgentTemplate,
  toolWebhookUrl: string,
  options: CompileConversationFlowOptions = {},
): CompiledTemplate {
  const flow: CompiledFlowRequest =
    template.compile_target === "conversation_flow"
      ? {
          kind: "conversation_flow",
          body: compileConversationFlow(template, toolWebhookUrl, options),
        }
      : template.compile_target === "multi_prompt"
        ? { kind: "multi_prompt", body: compileMultiPrompt(template, toolWebhookUrl, options) }
        : { kind: "single_prompt", body: compileSinglePrompt(template, toolWebhookUrl, options) };

  return {
    compileTarget: template.compile_target,
    disclosureVerified: verifyDisclosureGate(flow, template.disclosure_line),
    flow,
    postCallAnalysisData: buildPostCallAnalysisData(template),
  };
}
