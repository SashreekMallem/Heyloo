/**
 * Compile-time SDK contract test (RETELL-VERIFY, docs/VERIFY.md).
 *
 * This is NOT a runtime test — every assertion here is a TYPE
 * assignability check that `tsc` (via `vitest`'s type-checked transform)
 * enforces at compile time. It imports the OFFICIAL `retell-sdk`'s own
 * generated request/response types (the same package published from
 * `RetellAI/retell-typescript-sdk`, the authoritative source this whole
 * RETELL-VERIFY pass was built against — see docs/VERIFY.md and
 * docs/BUILD_NOTES.md's RETELL-VERIFY entry) and statically asserts that
 * this package's compiler/request-builder OUTPUT is structurally
 * assignable to the SDK's real types. A future SDK version that renames or
 * removes a field this codebase relies on fails `tsc` here — it can never
 * silently drift the way a hand-maintained runtime fixture can.
 *
 * `retell-sdk` is a devDependency of THIS package ONLY (`package.json`) —
 * never a runtime dependency, and never imported anywhere outside this
 * file (CLAUDE.md Rule 2: nothing outside `packages/adapters/retell` may
 * reference a provider SDK at all; within this package, `raw-types.ts`'s
 * hand-written Zod schemas remain the actual RUNTIME boundary — this file
 * only proves those hand-written shapes agree with the SDK's own, it does
 * not replace them).
 *
 * If a real field is intentionally narrower/wider than the SDK (e.g. this
 * codebase's `model: string` vs. the SDK's closed per-vendor model-id
 * union — a deliberate business decision, not a wire-shape question), the
 * check below substitutes one concrete, currently-valid SDK literal so the
 * STRUCTURAL shape is what's actually being verified.
 */

import type { AgentCreateParams, AgentPublishParams } from "retell-sdk/resources/agent";
import type { ConversationFlowCreateParams } from "retell-sdk/resources/conversation-flow";
import type { LlmCreateParams } from "retell-sdk/resources/llm";
import type { PhoneNumberImportParams } from "retell-sdk/resources/phone-number";
import { describe, it } from "vitest";

import { compileConversationFlow } from "./compiler/conversation-flow.js";
import { compileMultiPrompt } from "./compiler/multi-prompt.js";
import { compileSinglePrompt } from "./compiler/single-prompt.js";
import type {
  RetellConversationFlowRequest,
  RetellFlowEdge,
  RetellFunctionTool,
  RetellMultiPromptRequest,
  RetellSinglePromptRequest,
  RetellStateTool,
} from "./compiler/types.js";
import {
  AUTO_CONVERSATION_FLOW_TEMPLATE,
  LEGAL_MULTI_PROMPT_TEMPLATE,
  REAL_ESTATE_SINGLE_PROMPT_TEMPLATE,
} from "./fixtures/templates.js";

const TOOL_WEBHOOK_URL = "https://example.supabase.co/functions/v1/voice-tools";

/** Pure compile-time helper — never actually invoked at runtime. */
function assertAssignable<T>(_value: T): void {
  // intentionally empty: this function exists only so its call sites force
  // a `tsc` assignability check between the argument's inferred type and T.
}

// ---------------------------------------------------------------------------
// A single custom-function tool must be assignable to the SDK's own
// `CustomTool` union member, for BOTH surfaces that accept one (conversation
// flow's top-level `tools[]` and Retell LLM's `general_tools`/state `tools`).
// ---------------------------------------------------------------------------

function assertFunctionToolShape(tool: RetellFunctionTool): void {
  assertAssignable<ConversationFlowCreateParams.CustomTool>(tool);
  assertAssignable<LlmCreateParams.CustomTool>(tool);
}

/** `RetellStateTool` (multi_prompt/single_prompt tool slots) — either a custom function or the native transfer_call tool (GAP_REGISTER §1.4 item 4). */
function assertStateToolShape(tool: RetellStateTool): void {
  if (tool.type === "custom") {
    assertFunctionToolShape(tool);
  } else {
    assertAssignable<LlmCreateParams.TransferCallTool>(tool);
  }
}

function assertEdgeShape(edge: RetellFlowEdge): void {
  assertAssignable<ConversationFlowCreateParams.ConversationNode.Edge>(edge);
  // FunctionNode/TransferCallNode edges are a structurally distinct SDK
  // type from ConversationNode.Edge (different namespace) but identical on
  // the wire (`{id, transition_condition, destination_node_id?}`) —
  // asserted separately so a future SDK divergence between them is caught.
  assertAssignable<ConversationFlowCreateParams.FunctionNode.Edge>(edge);
}

// ---------------------------------------------------------------------------
// Conversation Flow — the compiler's own output, plus the `model_choice`
// object `agents.ts` attaches immediately before the REST call (VERIFY-8).
// ---------------------------------------------------------------------------

function assertConversationFlowRequestShape(body: RetellConversationFlowRequest): void {
  const withModel: ConversationFlowCreateParams = {
    ...body,
    // A concrete, currently-valid model id — see file header: the SDK's
    // closed model-id union is a business-config concern, not a wire-shape
    // one, so this substitutes one literal to isolate the actual shape check.
    model_choice: { model: "gpt-4.1", type: "cascading" },
  };
  assertAssignable<ConversationFlowCreateParams>(withModel);

  for (const node of body.nodes) {
    if (node.type === "conversation") {
      assertAssignable<ConversationFlowCreateParams.ConversationNode>(node);
      for (const edge of node.edges) assertEdgeShape(edge);
    } else if (node.type === "function") {
      // GAP_REGISTER §1.4: single-tool states hard-lock to a Function Node.
      assertAssignable<ConversationFlowCreateParams.FunctionNode>(node);
      for (const edge of node.edges ?? []) assertEdgeShape(edge);
    } else if (node.type === "transfer_call") {
      // GAP_REGISTER §1.4 item 4: native transfer, not a custom webhook.
      assertAssignable<ConversationFlowCreateParams.TransferCallNode>(node);
    } else {
      assertAssignable<ConversationFlowCreateParams.EndNode>(node);
    }
  }
  for (const tool of body.tools) assertFunctionToolShape(tool);
}

// ---------------------------------------------------------------------------
// Retell LLM — multi_prompt (states) and single_prompt (general-only).
// Both keep a flat, optional `model` (confirmed NOT nested, unlike
// conversation-flow) — substituting the same concrete literal.
// ---------------------------------------------------------------------------

function assertMultiPromptRequestShape(body: RetellMultiPromptRequest): void {
  const withModel: LlmCreateParams = { ...body, model: "gpt-4.1" };
  assertAssignable<LlmCreateParams>(withModel);

  for (const state of body.states) {
    assertAssignable<LlmCreateParams.State>(state);
    for (const tool of state.tools) assertStateToolShape(tool);
  }
}

function assertSinglePromptRequestShape(body: RetellSinglePromptRequest): void {
  const withModel: LlmCreateParams = { ...body, model: "gpt-4.1" };
  assertAssignable<LlmCreateParams>(withModel);
  for (const tool of body.general_tools) assertStateToolShape(tool);
}

// ---------------------------------------------------------------------------
// Agent create/publish envelopes — the discriminated `response_engine`
// union this package's agents.ts builds (VERIFY-6), and the
// `{version}`-carrying publish body (VERIFY-6, resolved: publish is NOT a
// bodyless call).
// ---------------------------------------------------------------------------

function assertResponseEngineShape(): void {
  const conversationFlowEngine: AgentCreateParams.ResponseEngineConversationFlow = {
    type: "conversation-flow",
    conversation_flow_id: "conversation_flow_123",
  };
  const retellLlmEngine: AgentCreateParams.ResponseEngineRetellLm = {
    type: "retell-llm",
    llm_id: "llm_123",
  };
  assertAssignable<AgentCreateParams["response_engine"]>(conversationFlowEngine);
  assertAssignable<AgentCreateParams["response_engine"]>(retellLlmEngine);
}

function assertPublishAgentVersionBodyShape(): void {
  const body: AgentPublishParams = { version: 3 };
  assertAssignable<AgentPublishParams>(body);
}

// ---------------------------------------------------------------------------
// Phone number import — the corrected `inbound_agents`/`outbound_agents`
// (weighted arrays, not bare ids) and `inbound_webhook_url` (VERIFY-7).
// ---------------------------------------------------------------------------

function assertImportPhoneNumberBodyShape(): void {
  const body: PhoneNumberImportParams = {
    phone_number: "+15551234567",
    termination_uri: "heyloo-trunk.pstn.twilio.com",
    inbound_agents: [{ agent_id: "agent_1", weight: 1 }],
    outbound_agents: [{ agent_id: "agent_2", weight: 1 }],
    inbound_webhook_url: "https://example.supabase.co/functions/v1/voice-inbound",
    sip_trunk_auth_username: "user",
    sip_trunk_auth_password: "pass",
  };
  assertAssignable<PhoneNumberImportParams>(body);
}

describe("retell-sdk compile-time contract (RETELL-VERIFY)", () => {
  // Every "it" body below is unreachable in the sense that it asserts
  // nothing at runtime — the assignability checks above already ran at
  // `tsc` time just by this file compiling at all. The `it` blocks exist so
  // `vitest run` reports this file as covered/exercised in CI output,
  // rather than a silent compile-only file nobody notices if it's ever
  // accidentally excluded from the TypeScript project.
  it("conversation_flow compiler output is assignable to ConversationFlowCreateParams", () => {
    assertConversationFlowRequestShape(
      compileConversationFlow(AUTO_CONVERSATION_FLOW_TEMPLATE, TOOL_WEBHOOK_URL),
    );
  });

  it("multi_prompt compiler output is assignable to LlmCreateParams", () => {
    assertMultiPromptRequestShape(
      compileMultiPrompt(LEGAL_MULTI_PROMPT_TEMPLATE, TOOL_WEBHOOK_URL),
    );
  });

  it("single_prompt compiler output is assignable to LlmCreateParams", () => {
    assertSinglePromptRequestShape(
      compileSinglePrompt(REAL_ESTATE_SINGLE_PROMPT_TEMPLATE, TOOL_WEBHOOK_URL),
    );
  });

  it("response_engine discriminated union is assignable to AgentCreateParams['response_engine']", () => {
    assertResponseEngineShape();
  });

  it("publish-agent-version body is assignable to AgentPublishParams", () => {
    assertPublishAgentVersionBodyShape();
  });

  it("import-phone-number body is assignable to PhoneNumberImportParams", () => {
    assertImportPhoneNumberBodyShape();
  });
});
