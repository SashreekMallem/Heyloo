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
import { describe, expect, it } from "vitest";
import { compileConversationFlow as compileNodeConversationFlow } from "./conversation-flow.js";

const DENO_TEMPLATE_COMPILER_URL = new URL(
  "../../../../../supabase/functions/_shared/compiler/template-compiler.ts",
  import.meta.url,
);

interface DenoNode {
  id: string;
  type: string;
  edges?: Array<{ destination_node_id: string }>;
  edge?: { destination_node_id?: string };
}
interface DenoCompiledTemplate {
  flow: { kind: string; body: { nodes: DenoNode[]; start_node_id: string } };
}
interface DenoCompilerModule {
  compileTemplate: (
    template: unknown,
    toolWebhookUrl: string,
    options?: { transferNumber?: string | null },
  ) => DenoCompiledTemplate;
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

/** Node id -> {type, edge destination ids} — ignores edge ids/prompt wording/field ordering, only the structural shape. */
function shapeOf(nodes: DenoNode[]): Record<string, { type: string; edgesTo: string[] }> {
  const out: Record<string, { type: string; edgesTo: string[] }> = {};
  for (const n of nodes) {
    const edgesTo = n.edges
      ? n.edges.map((e) => e.destination_node_id).sort()
      : n.edge?.destination_node_id
        ? [n.edge.destination_node_id]
        : [];
    out[n.id] = { type: n.type, edgesTo };
  }
  return out;
}

describe("Deno (live) vs. Node (packages/adapters/retell) conversation_flow compiler parity — CALL-4/PUBLISH-1", () => {
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
      expect(nodeShape[id]?.type, `node '${id}' type`).toBe(denoShape[id]?.type);
      expect(nodeShape[id]?.edgesTo, `node '${id}' edge destinations`).toEqual(
        denoShape[id]?.edgesTo,
      );
    }
    expect(denoCompiled.flow.body.start_node_id).toBe(nodeFlow.start_node_id);

    // Both compilers ALWAYS emit the dedicated transfer node now, and its
    // router (the original state id) has an edge onto it.
    expect(denoShape["transfer_to_human__transfer"]?.type).toBe("transfer_call");
    expect(nodeShape["transfer_to_human__transfer"]?.type).toBe("transfer_call");
    expect(denoShape["transfer_to_human"]?.edgesTo).toContain("transfer_to_human__transfer");
    expect(nodeShape["transfer_to_human"]?.edgesTo).toContain("transfer_to_human__transfer");
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
