/**
 * Cross-compiler parity check (CALL-4, docs/BUILD_NOTES.md task item 3):
 * `supabase/functions/_shared/compiler/template-compiler.ts` (the LIVE Deno
 * compiler, the one every real tenant's agent is actually compiled through)
 * and this package's `compiler/conversation-flow.ts` (the Node sibling,
 * consumed by `packages/templates`' red-team suite — see this file's own
 * header comment) are a DELIBERATE duplication kept in sync by hand
 * (Deno/Node workspace-package boundary, both files' own header comments).
 * This test is the thing that actually enforces "kept in sync" instead of
 * just asserting it in prose: it compiles the SAME fixture template through
 * BOTH compilers and asserts they emit matching node types and matching
 * edge destination sets per node — not matching wire bytes (edge ids,
 * exact prompt wording, and field ordering are allowed to differ; only the
 * STRUCTURAL shape — which node exists, what type it is, and where its
 * edges point — has to agree, since that's what actually determines call
 * behavior).
 *
 * The Deno file has ZERO imports (a deliberately self-contained, portable
 * module — see its own header comment) and no Deno-specific globals, so
 * it's plain, dependency-free TypeScript that Node/vitest can execute
 * directly. It's loaded here via a genuinely DYNAMIC `import()` (the
 * specifier is a computed `URL`, never a string literal) specifically so
 * `tsc -b`'s project-reference build (this package's tsconfig: `rootDir:
 * "src"`, which would otherwise refuse to compile a static import reaching
 * outside `src/`) never sees it as part of this package's own program —
 * only vitest's real module loader (vite-node) resolves and transforms it
 * at test time, so this is a genuine cross-compiler run, not a stub.
 */

import type { AgentTemplate } from "@heyloo/canonical-types";
import type { ConversationFlowCreateParams } from "retell-sdk/resources/conversation-flow";
import type { LlmCreateParams } from "retell-sdk/resources/llm";
import { describe, expect, it } from "vitest";
import { compileConversationFlow as compileNodeConversationFlow } from "./conversation-flow.js";
import { compileMultiPrompt as compileNodeMultiPrompt } from "./multi-prompt.js";
import {
  buildOpeningLine as buildNodeOpeningLine,
  COMPILER_DEFAULT_DYNAMIC_VARIABLES as NODE_DEFAULT_DYNAMIC_VARIABLES,
} from "./opening.js";
import {
  AGENT_COMPILER_VERSION as NODE_AGENT_COMPILER_VERSION,
  OWNER_INFO_INSTRUCTIONS as NODE_OWNER_INFO_INSTRUCTIONS,
} from "./owner-info.js";
import { compileSinglePrompt as compileNodeSinglePrompt } from "./single-prompt.js";

const DENO_TEMPLATE_COMPILER_URL = new URL(
  "../../../../../supabase/functions/_shared/compiler/template-compiler.ts",
  import.meta.url,
);

interface DenoNode {
  id: string;
  type: string;
  edges?: Array<{ destination_node_id: string }>;
  edge?: { destination_node_id?: string };
  else_edge?: { destination_node_id?: string };
  instruction?: { type: string; text: string };
}
interface DenoCompiledTemplate {
  flow: {
    kind: string;
    body: {
      nodes: DenoNode[];
      start_node_id: string;
      begin_message?: string;
      start_speaker?: string;
      default_dynamic_variables?: Record<string, string>;
      states?: Array<{ name: string; tools: unknown[] }>;
    };
  };
  disclosureVerified: boolean;
  openingLine: { text: string; disclosureLiteral: string; language: string };
}
interface DenoCompilerModule {
  compileTemplate: (
    template: unknown,
    toolWebhookUrl: string,
    options?: { transferNumber?: string | null; language?: string },
  ) => DenoCompiledTemplate;
  buildOpeningLine: (
    disclosureLine: string,
    language?: string,
  ) => { text: string; disclosureLiteral: string; language: string };
}

async function loadDenoCompiler(): Promise<DenoCompilerModule> {
  return (await import(DENO_TEMPLATE_COMPILER_URL.href)) as unknown as DenoCompilerModule;
}

const TOOL_WEBHOOK_URL = "https://example.supabase.co/functions/v1/voice-tools";

/**
 * One fixture exercising every node-type decision both compilers make:
 * a zero-tool state (greeting/start), a single-tool state (subagent), a
 * multi-tool state (subagent), a transfer-only `is_terminal` state, and a
 * non-transfer `is_terminal` state — enough to compare subagent, end-node,
 * and transfer-call parity in one compile.
 */
const PARITY_TEMPLATE: AgentTemplate = {
  vertical: "auto",
  compile_target: "conversation_flow",
  system_prompt: "You help callers of a small auto shop.",
  states: [
    { id: "greeting", name: "Greeting", prompt_fragment: "Greet the caller.", allowed_tools: [] },
    {
      id: "check_time",
      name: "Check availability",
      prompt_fragment: "Check availability.",
      allowed_tools: ["check_availability"],
    },
    {
      id: "confirm_booking",
      name: "Confirm booking",
      prompt_fragment: "Confirm and book.",
      allowed_tools: ["check_availability", "create_booking"],
      is_terminal: true,
    },
    {
      id: "transfer_to_human",
      name: "Transfer to human",
      prompt_fragment: "Connect the caller to a human.",
      allowed_tools: ["transfer_call"],
      is_terminal: true,
    },
  ],
  transitions: [
    { from: "greeting", to: "check_time", on: { intent: "wants_to_book" } },
    { from: "check_time", to: "confirm_booking", on: { predicate: "slot_selected" } },
  ],
  global_intents: [
    {
      name: "human_request",
      reachable_from: "any",
      target_state: "transfer_to_human",
      description: "The caller explicitly asks for a human.",
    },
  ],
  tools: [
    {
      name: "check_availability",
      description: "Check open slots.",
      parameters: { type: "object", properties: { date_range: { type: "object" } } },
      authorization: { scope: "none" },
    },
    {
      name: "create_booking",
      description: "Create a booking.",
      parameters: { type: "object", properties: { resource_id: { type: "string" } } },
      authorization: { scope: "none" },
    },
    {
      name: "take_message",
      description: "Record a message.",
      parameters: { type: "object", properties: { message_text: { type: "string" } } },
      authorization: { scope: "none" },
    },
    {
      name: "transfer_call",
      description: "Warm-transfer the caller to a human.",
      parameters: { type: "object", properties: {} },
      authorization: { scope: "tenant_config_only" },
    },
  ],
  disclosure_line: "This call may be recorded and you're speaking with an AI assistant.",
};

/** Node id -> {type, edge destination ids} — ignores edge ids/prompt wording/field ordering, only the structural shape. DISCLOSE-1: an `else_edge` destination is included as `else:<id>`. */
function shapeOf(nodes: DenoNode[]): Record<string, { type: string; edgesTo: string[] }> {
  const out: Record<string, { type: string; edgesTo: string[] }> = {};
  for (const n of nodes) {
    const edgesTo = [
      ...(n.edges ?? []).map((e) => e.destination_node_id),
      ...(n.edge?.destination_node_id ? [n.edge.destination_node_id] : []),
      ...(n.else_edge?.destination_node_id ? [`else:${n.else_edge.destination_node_id}`] : []),
    ].sort();
    out[n.id] = { type: n.type, edgesTo };
  }
  return out;
}

/**
 * DISCLOSE-1 (docs/BUILD_NOTES.md): the ONE documented structural
 * difference between the two compilers. The live Deno compiler emits a
 * transfer-only state's router as a silent Retell logic-split node
 * (`type: "branch"`); this package emits a `"conversation"` node with the
 * identical deterministic equation edge + else edge, because typing a
 * `"branch"` node here requires a one-line extension to
 * `src/sdk-contract.test.ts` (outside this compiler directory). Every other
 * node id, type and edge destination must still match exactly.
 */
function expectedNodeType(denoType: string): string {
  return denoType === "branch" ? "conversation" : denoType;
}

/** The one disclosure line every shipped template uses (`agent-template-seeds.ts`) — the key of both compilers' translation tables. */
const SHIPPED_DISCLOSURE_LINE =
  "Thanks for calling {{business_name}}. This is {{assistant_name}}, their AI assistant — this call may be recorded.";

describe("Deno (live) vs. Node (packages/adapters/retell) conversation_flow compiler parity — CALL-4/PUBLISH-1/DISCLOSE-1", () => {
  // PUBLISH-1 (docs/BUILD_NOTES.md): `options.transferNumber` no longer
  // affects the compiled output AT ALL in either compiler — a transfer-
  // only state now ALWAYS compiles to the same router + `{{transfer_number}}`
  // token TransferCallNode pair (the live value is resolved by Retell per
  // call, never at compile time) — so this test no longer needs two
  // variants ("with"/"without" a configured number) to prove parity; one
  // compile (with the option omitted, the common real-world case) proves
  // both compilers agree on the one shape that now always exists.
  it("same node ids, same node types, same edge-destination sets per node — including the always-present transfer router + transfer_call pair", async () => {
    const denoCompiler = await loadDenoCompiler();
    const denoCompiled = denoCompiler.compileTemplate(PARITY_TEMPLATE, TOOL_WEBHOOK_URL);
    if (denoCompiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    const denoShape = shapeOf(denoCompiled.flow.body.nodes);

    const nodeFlow = compileNodeConversationFlow(PARITY_TEMPLATE, TOOL_WEBHOOK_URL);
    const nodeShape = shapeOf(nodeFlow.nodes as unknown as DenoNode[]);

    expect(Object.keys(nodeShape).sort()).toEqual(Object.keys(denoShape).sort());
    for (const id of Object.keys(denoShape)) {
      expect(nodeShape[id]?.type, `node '${id}' type`).toBe(
        expectedNodeType(denoShape[id]?.type ?? ""),
      );
      expect(nodeShape[id]?.edgesTo, `node '${id}' edge destinations`).toEqual(
        denoShape[id]?.edgesTo,
      );
    }
    expect(denoCompiled.flow.body.start_node_id).toBe(nodeFlow.start_node_id);

    // Both compilers ALWAYS emit the dedicated transfer node now, and its
    // router (the original state id) has an edge onto it — plus (DISCLOSE-1)
    // an else edge onto the honest no-transfer fallback.
    expect(denoShape["transfer_to_human__transfer"]?.type).toBe("transfer_call");
    expect(nodeShape["transfer_to_human__transfer"]?.type).toBe("transfer_call");
    expect(denoShape["transfer_to_human"]?.edgesTo).toContain("transfer_to_human__transfer");
    expect(nodeShape["transfer_to_human"]?.edgesTo).toContain("transfer_to_human__transfer");
    expect(denoShape["transfer_to_human"]?.edgesTo).toContain(
      "else:transfer_to_human__no_transfer",
    );
    expect(denoShape["transfer_to_human"]?.type).toBe("branch");
    // DISCLOSE-1: both start on the same static opening node.
    expect(denoCompiled.flow.body.start_node_id).toBe("__opening");
  });

  it("DISCLOSE-1: both compilers speak the identical static opening line", async () => {
    const denoCompiler = await loadDenoCompiler();
    const denoCompiled = denoCompiler.compileTemplate(PARITY_TEMPLATE, TOOL_WEBHOOK_URL);
    const nodeFlow = compileNodeConversationFlow(PARITY_TEMPLATE, TOOL_WEBHOOK_URL);
    const denoOpening = denoCompiled.flow.body.nodes.find((n) => n.id === "__opening");
    const nodeOpening = nodeFlow.nodes.find((n) => n.id === "__opening");
    expect(nodeOpening?.type === "conversation" ? nodeOpening.instruction : undefined).toEqual(
      denoOpening?.instruction,
    );
    // DISCLOSE-1 review: both block interruptions on the opening node only.
    expect(
      nodeOpening?.type === "conversation" ? nodeOpening.interruption_sensitivity : undefined,
    ).toBe(0);
    expect(
      denoOpening && "interruption_sensitivity" in denoOpening
        ? denoOpening.interruption_sensitivity
        : undefined,
    ).toBe(0);
    expect(denoOpening?.instruction?.type).toBe("static_text");
    for (const language of ["en", "es", "fr"]) {
      for (const line of [PARITY_TEMPLATE.disclosure_line, SHIPPED_DISCLOSURE_LINE]) {
        expect(buildNodeOpeningLine(line, language)).toEqual(
          denoCompiler.buildOpeningLine(line, language),
        );
      }
    }
    expect(denoCompiled.disclosureVerified).toBe(true);
  });

  it("a passed transferNumber option is ignored identically by both compilers (dead back-compat input, PUBLISH-1)", async () => {
    const denoCompiler = await loadDenoCompiler();
    const withOption = denoCompiler.compileTemplate(PARITY_TEMPLATE, TOOL_WEBHOOK_URL, {
      transferNumber: "+15551234567",
    });
    const withoutOption = denoCompiler.compileTemplate(PARITY_TEMPLATE, TOOL_WEBHOOK_URL);
    if (
      withOption.flow.kind !== "conversation_flow" ||
      withoutOption.flow.kind !== "conversation_flow"
    ) {
      throw new Error("wrong kind");
    }
    expect(shapeOf(withOption.flow.body.nodes)).toEqual(shapeOf(withoutOption.flow.body.nodes));

    const nodeWithOption = compileNodeConversationFlow(PARITY_TEMPLATE, TOOL_WEBHOOK_URL, {
      transferNumber: "+15551234567",
    });
    const nodeWithoutOption = compileNodeConversationFlow(PARITY_TEMPLATE, TOOL_WEBHOOK_URL);
    expect(shapeOf(nodeWithOption.nodes as unknown as DenoNode[])).toEqual(
      shapeOf(nodeWithoutOption.nodes as unknown as DenoNode[]),
    );
  });
});

/**
 * DISCLOSE-1 (docs/BUILD_NOTES.md, CLAUDE.md Rule 1): `src/sdk-contract.test.ts`
 * type-checks THIS package's compiler output against the real retell-sdk
 * types, but the LIVE compiler is the Deno one, whose output tsc cannot see
 * from here (dynamic import, see this file's header). So the new node/field
 * shapes the Deno compiler emits are written out below as literals TYPED
 * against retell-sdk 5.64.0's own `ConversationFlowCreateParams`/
 * `LlmCreateParams` (a shape mistake fails `tsc -b`), and the Deno runtime
 * output is asserted `toEqual` to them — together, a real SDK contract check
 * of what production actually sends.
 */
describe("DISCLOSE-1: the live (Deno) compiler's new shapes match retell-sdk's own types", () => {
  const OPENING_TEXT = `${PARITY_TEMPLATE.disclosure_line} {{caller_greeting}} How can I help you today?`;

  it("static opening node, logic-split router, announcing transfer node", async () => {
    const denoCompiler = await loadDenoCompiler();
    const compiled = denoCompiler.compileTemplate(PARITY_TEMPLATE, TOOL_WEBHOOK_URL);
    const byId = new Map(compiled.flow.body.nodes.map((n) => [n.id, n]));

    const opening: ConversationFlowCreateParams.ConversationNode = {
      id: "__opening",
      type: "conversation",
      name: "Opening — AI and recording disclosure",
      instruction: { type: "static_text", text: OPENING_TEXT },
      // DISCLOSE-1 review: Retell's "Block Interruptions" for the disclaimer
      // node (docs.retellai.com/accounts/privacy-disable) — typed against the
      // SDK's own node-level override field.
      interruption_sensitivity: 0,
      edges: [
        {
          id: "opening_edge_greeting_check_time_0",
          destination_node_id: "check_time",
          transition_condition: { type: "prompt", prompt: "wants_to_book" },
        },
      ],
      else_edge: {
        id: "edge_opening_else",
        destination_node_id: "greeting",
        transition_condition: { type: "prompt", prompt: "Else" },
      },
    };
    expect(byId.get("__opening")).toEqual(opening);

    const router: ConversationFlowCreateParams.BranchNode = {
      id: "transfer_to_human",
      type: "branch",
      name: "Transfer to human",
      edges: [
        {
          id: "edge_transfer_to_human_has_transfer",
          destination_node_id: "transfer_to_human__transfer",
          transition_condition: {
            type: "equation",
            operator: "&&",
            equations: [{ left: "{{transfer_number}}", operator: "contains", right: "+" }],
          },
        },
      ],
      else_edge: {
        id: "edge_transfer_to_human_no_transfer",
        destination_node_id: "transfer_to_human__no_transfer",
        transition_condition: { type: "prompt", prompt: "Else" },
      },
      global_node_setting: { condition: "The caller explicitly asks for a human." },
    };
    expect(byId.get("transfer_to_human")).toEqual(router);

    const transfer: ConversationFlowCreateParams.TransferCallNode = {
      id: "transfer_to_human__transfer",
      type: "transfer_call",
      name: "Transfer to human — live transfer",
      transfer_destination: { type: "predefined", number: "{{transfer_number}}" },
      transfer_option: { type: "warm_transfer" },
      speak_during_execution: true,
      instruction: {
        type: "prompt",
        text:
          "In one short, warm sentence, tell the caller you're connecting them to a member of " +
          "the team now. Say nothing else.",
      },
      edge: {
        id: "transfer_to_human_transfer_failed",
        destination_node_id: "transfer_to_human__no_transfer",
        transition_condition: { type: "prompt", prompt: "Transfer failed" },
      },
    };
    expect(byId.get("transfer_to_human__transfer")).toEqual(transfer);

    const flowDefaults: ConversationFlowCreateParams["default_dynamic_variables"] =
      compiled.flow.body.default_dynamic_variables ?? null;
    expect(flowDefaults).toMatchObject({ caller_greeting: "", transfer_number: "" });
  });

  it("retell-llm begin_message / start_speaker / announcing transfer tool", async () => {
    const denoCompiler = await loadDenoCompiler();
    const compiled = denoCompiler.compileTemplate(
      { ...PARITY_TEMPLATE, compile_target: "multi_prompt" },
      TOOL_WEBHOOK_URL,
    );
    const opening: Pick<LlmCreateParams, "begin_message" | "start_speaker"> = {
      begin_message: OPENING_TEXT,
      start_speaker: "agent",
    };
    expect({
      begin_message: compiled.flow.body.begin_message,
      start_speaker: compiled.flow.body.start_speaker,
    }).toEqual(opening);

    const transferTool: LlmCreateParams.State.TransferCallTool = {
      type: "transfer_call",
      name: "transfer_call",
      description: "Warm-transfer the caller to a human.",
      transfer_destination: { type: "predefined", number: "{{transfer_number}}" },
      transfer_option: { type: "warm_transfer" },
      speak_during_execution: true,
      execution_message_type: "prompt",
      execution_message_description:
        "In one short, warm sentence, tell the caller you're connecting them to a member of " +
        "the team now. Say nothing else.",
    };
    const transferState = compiled.flow.body.states?.find((s) => s.name === "transfer_to_human");
    expect(transferState?.tools).toEqual([transferTool]);
    // This package's own multi_prompt compile emits the same opening fields.
    const nodeLlm = compileNodeMultiPrompt(
      { ...PARITY_TEMPLATE, compile_target: "multi_prompt" },
      TOOL_WEBHOOK_URL,
    );
    expect({ begin_message: nodeLlm.begin_message, start_speaker: nodeLlm.start_speaker }).toEqual(
      opening,
    );
  });
});

describe("Deno <-> Node parity: SETTINGS-2 owner-info block and compiler version", () => {
  it("both compilers carry the byte-identical owner-info block, version stamp and defaults", async () => {
    const deno = (await loadDenoCompiler()) as DenoCompilerModule & {
      OWNER_INFO_INSTRUCTIONS: string;
      AGENT_COMPILER_VERSION: number;
    };
    expect(NODE_OWNER_INFO_INSTRUCTIONS).toBe(deno.OWNER_INFO_INSTRUCTIONS);
    expect(NODE_AGENT_COMPILER_VERSION).toBe(deno.AGENT_COMPILER_VERSION);

    // The same settings defaults reach the Deno flow body.
    const denoBody = deno.compileTemplate(PARITY_TEMPLATE, TOOL_WEBHOOK_URL).flow.body;
    for (const [key, value] of Object.entries(NODE_DEFAULT_DYNAMIC_VARIABLES)) {
      if (key === "caller_greeting" || key === "transfer_number") continue;
      expect(denoBody.default_dynamic_variables?.[key], key).toBe(value);
    }
  });

  it("every compile target of both compilers puts the owner-info block in the global prompt", async () => {
    const deno = await loadDenoCompiler();
    for (const target of ["conversation_flow", "multi_prompt", "single_prompt"] as const) {
      const template = { ...PARITY_TEMPLATE, compile_target: target };
      const denoFlow = deno.compileTemplate(template, TOOL_WEBHOOK_URL).flow as unknown as {
        body: { global_prompt?: string; general_prompt?: string };
      };
      const denoPrompt = denoFlow.body.global_prompt ?? denoFlow.body.general_prompt ?? "";
      expect(denoPrompt, `deno ${target}`).toContain("[[BEGIN OWNER INFO]]");
      const node =
        target === "conversation_flow"
          ? compileNodeConversationFlow(template, TOOL_WEBHOOK_URL).global_prompt
          : target === "multi_prompt"
            ? compileNodeMultiPrompt(template, TOOL_WEBHOOK_URL).general_prompt
            : compileNodeSinglePrompt(template, TOOL_WEBHOOK_URL).general_prompt;
      expect(node, `node ${target}`).toContain(NODE_OWNER_INFO_INSTRUCTIONS);
    }
  });
});
