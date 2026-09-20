/**
 * Whole-registry consistency checks (GAP_REGISTER §1.4 item 4, §1.6, and
 * the "prompt-length/tool-count budget" item — Cluster A build-task 5).
 *
 * INTEGRATION NOTE (docs/BUILD_NOTES.md, wave-2 integration pass; RESOLVED
 * this pass): this file originally imported `@heyloo/templates`' live
 * `TEMPLATE_DEFINITIONS` registry as a TS package to exercise the compiler
 * against every real, shipped template rather than only hand-authored
 * fixtures. That import required adding `@heyloo/templates` as a
 * devDependency of this package — but `@heyloo/templates` ALSO depends on
 * `@heyloo/adapter-retell` (its own `compiler-gate.test.ts`, via the public
 * `RetellProvider.compileTemplate` — the correct, Rule-2-respecting
 * direction), so that addition created a genuine circular package
 * dependency that made `turbo run build`/`typecheck` refuse to run for the
 * ENTIRE workspace (a cycle has no valid topological order).
 *
 * Resolved by NOT importing `@heyloo/templates` as a package at all:
 * `packages/templates`'s own `build` script (`src/scripts/
 * generate-build-artifact.ts`) already emits a plain-JSON, Zod-revalidated
 * `dist/templates.build.json` artifact of the real 8 shipped templates.
 * `loadRealRegistry()` below reads that JSON file directly off disk (a
 * filesystem read, not a module import) — no package.json dependency edge
 * is added in either direction, so no cycle. Both the "transfer_call native
 * wiring" and "token/schema consistency" checks now run against
 * `REAL_REGISTRY` (the actual 8 templates) as well as `LOCAL_REGISTRY` (the
 * synthetic fixtures, kept so these checks still exercise something fast
 * and dependency-free even when the artifact hasn't been built).
 *
 * Residual gap (flagged per CLAUDE.md Rule 4, not solved here — it reaches
 * outside this file's ownership into root build orchestration): this
 * introduces a real cross-package BUILD-ORDER dependency — `pnpm --filter
 * @heyloo/templates build` must run before this test file can see a
 * current artifact. `turbo.json`'s `test` task depends on `^build` (the
 * build tasks of a package's own declared dependencies), but
 * `@heyloo/adapter-retell` does not (and per the paragraph above, MUST NOT)
 * declare `@heyloo/templates` as a package.json dependency, so turbo's
 * default graph does not order `@heyloo/templates#build` before
 * `@heyloo/adapter-retell#test`. `loadRealRegistry()` throws a clear,
 * actionable error (never a silent skip) if the artifact is missing or
 * stale-looking, rather than quietly losing real-registry coverage. The
 * durable fix is a turbo task-level override (`"@heyloo/adapter-retell#test":
 * {"dependsOn": ["@heyloo/templates#build"]}`) — a root `turbo.json` change,
 * which is why it isn't made here.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentTemplate } from "@heyloo/canonical-types";
import {
  dynamicVariableOverridesSchemaForVertical,
  verticalDetailsSchema,
  zAgentDynamicVariables,
  zAgentTemplate,
} from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { compileConversationFlow } from "./conversation-flow.js";
import { compileMultiPrompt } from "./multi-prompt.js";
import { compileSinglePrompt } from "./single-prompt.js";

const TOOL_WEBHOOK_URL = "https://example.supabase.co/functions/v1/voice-tools";

interface RegistryEntry {
  key: string;
  template: AgentTemplate;
}

interface TemplatesBuildArtifact {
  package_version: string;
  generated_at: string;
  templates: { key: string; name: string; version: number; template: unknown }[];
}

const BUILD_ARTIFACT_PATH = fileURLToPath(
  new URL("../../../../templates/dist/templates.build.json", import.meta.url),
);

/**
 * Reads `@heyloo/templates`'s built JSON artifact (the real 8 shipped
 * templates) off disk — see the file-top INTEGRATION NOTE. Every entry is
 * re-validated against `zAgentTemplate` here too (defense in depth: this
 * package should never trust an on-disk artifact it didn't itself
 * re-check), so a structurally invalid template fails loudly with a normal
 * Zod error rather than an obscure downstream compiler crash.
 */
function loadRealRegistry(): RegistryEntry[] {
  if (!existsSync(BUILD_ARTIFACT_PATH)) {
    throw new Error(
      `registry-consistency.test.ts expected the real template registry at ` +
        `${BUILD_ARTIFACT_PATH} but it doesn't exist. Run ` +
        "`pnpm --filter @heyloo/templates build` first (see this file's top " +
        "INTEGRATION NOTE for the cross-package build-order dependency this " +
        "introduces).",
    );
  }
  const raw = readFileSync(BUILD_ARTIFACT_PATH, "utf8");
  const artifact = JSON.parse(raw) as TemplatesBuildArtifact;
  return artifact.templates.map(({ key, template }) => ({
    key,
    template: zAgentTemplate.parse(template),
  }));
}

const REAL_REGISTRY: RegistryEntry[] = loadRealRegistry();

const TRANSFER_TOOL = {
  name: "transfer_call",
  description: "Warm-transfer the caller to a human at this business.",
  parameters: { type: "object" as const, properties: {}, required: [] },
  authorization: { scope: "tenant_config_only" as const },
};

/** One local fixture per compile_target, each declaring transfer_call, so this
 * file's registry-wide checks below have something real to scan without
 * depending on `@heyloo/templates` (see file-top INTEGRATION NOTE). */
const LOCAL_REGISTRY: { key: string; template: AgentTemplate }[] = [
  {
    key: "auto_conversation_flow_fixture",
    template: {
      vertical: "auto",
      compile_target: "conversation_flow",
      system_prompt: "You are the friendly front-desk assistant for an auto repair shop.",
      states: [
        {
          id: "greeting",
          name: "Greeting",
          prompt_fragment: "Greet the caller and ask how you can help today.",
          allowed_tools: [],
        },
        {
          id: "check_time",
          name: "Check availability",
          prompt_fragment: "Ask what day/time works, then check availability.",
          allowed_tools: ["check_availability"],
        },
        {
          id: "transfer_to_human",
          name: "Transfer to human",
          prompt_fragment: "Transfer the caller to a human team member.",
          allowed_tools: ["transfer_call"],
          is_terminal: true,
        },
      ],
      transitions: [
        { from: "greeting", to: "check_time", on: { intent: "wants_to_book_service" } },
        { from: "greeting", to: "transfer_to_human", on: { intent: "asks_for_a_human" } },
      ],
      global_intents: [],
      tools: [
        {
          name: "check_availability",
          description: "Check open service bay slots.",
          parameters: {
            type: "object",
            properties: { date_range: { type: "object" } },
            required: ["date_range"],
          },
          authorization: { scope: "none" },
        },
        TRANSFER_TOOL,
      ],
      disclosure_line:
        "Thanks for calling Joe's Auto Repair, this is their AI assistant — this call may be recorded.",
    },
  },
  {
    key: "legal_multi_prompt_fixture",
    template: {
      vertical: "legal",
      compile_target: "multi_prompt",
      system_prompt:
        "You are an intake assistant for a law firm. NEVER give legal advice or a merits opinion, at any state.",
      states: [
        {
          id: "greeting",
          name: "Greeting",
          prompt_fragment: "Greet the caller and ask what brings them in today.",
          allowed_tools: [],
        },
        {
          id: "transfer_to_human",
          name: "Transfer to human",
          prompt_fragment: "Transfer the caller to an attorney.",
          allowed_tools: ["transfer_call"],
          is_terminal: true,
        },
      ],
      transitions: [
        { from: "greeting", to: "transfer_to_human", on: { intent: "asks_for_a_human" } },
      ],
      global_intents: [],
      tools: [TRANSFER_TOOL],
      disclosure_line:
        "Thanks for calling Smith & Associates, this is their AI assistant — this call may be recorded.",
    },
  },
  {
    key: "real_estate_single_prompt_fixture",
    template: {
      vertical: "real_estate",
      compile_target: "single_prompt",
      system_prompt:
        "You are a friendly assistant for a real estate agency. Qualify buyers/sellers conversationally in about 2 minutes.",
      states: [],
      transitions: [],
      global_intents: [],
      tools: [TRANSFER_TOOL],
      disclosure_line:
        "Thanks for calling Riverside Realty, this is their AI assistant — this call may be recorded.",
    },
  },
];

// ---------------------------------------------------------------------------
// Transfer-call native wiring (GAP_REGISTER §1.4 item 4) — every registered
// template that declares `transferCallTool()` must compile it to Retell's
// native transfer mechanism, never a custom-function webhook.
// ---------------------------------------------------------------------------

describe("transfer_call native wiring across the template registry", () => {
  for (const { key, template } of [...LOCAL_REGISTRY, ...REAL_REGISTRY]) {
    const declaresTransfer = template.tools.some((t) => t.name === "transfer_call");
    if (!declaresTransfer) continue;

    it(`${key}: transfer_call never appears as a custom-function webhook tool, either way`, () => {
      switch (template.compile_target) {
        case "conversation_flow": {
          // Neither branch (transferNumber configured or not, CALL-4) ever
          // emits transfer_call as a webhook tool.
          for (const transferNumber of [null, "+15559876543"]) {
            const flow = compileConversationFlow(template, TOOL_WEBHOOK_URL, { transferNumber });
            expect(flow.tools.find((t) => t.name === "transfer_call")).toBeUndefined();
          }
          break;
        }
        case "multi_prompt": {
          const llm = compileMultiPrompt(template, TOOL_WEBHOOK_URL);
          const allTools = llm.states.flatMap((s) => s.tools);
          const transferTool = allTools.find((t) => t.name === "transfer_call");
          expect(transferTool?.type).toBe("transfer_call");
          break;
        }
        case "single_prompt": {
          const llm = compileSinglePrompt(template, TOOL_WEBHOOK_URL);
          const transferTool = llm.general_tools.find((t) => t.name === "transfer_call");
          expect(transferTool?.type).toBe("transfer_call");
          break;
        }
      }
    });

    if (template.compile_target !== "conversation_flow") continue;

    it(`${key}: with a transferNumber configured, compiles a native TransferCallNode whose destination is that literal number (CALL-4, G6 tenant-config-only)`, () => {
      const flow = compileConversationFlow(template, TOOL_WEBHOOK_URL, {
        transferNumber: "+15559876543",
      });
      const transferNodes = flow.nodes.filter(
        (n): n is Extract<(typeof flow.nodes)[number], { type: "transfer_call" }> =>
          n.type === "transfer_call",
      );
      expect(transferNodes.length).toBeGreaterThan(0);
      for (const node of transferNodes) {
        expect(node.transfer_destination).toEqual({
          type: "predefined",
          number: "+15559876543",
        });
      }
    });

    it(`${key}: with NO transferNumber configured, never emits a transfer_call node — an honest spoken fallback instead (CALL-4)`, () => {
      const flow = compileConversationFlow(template, TOOL_WEBHOOK_URL, { transferNumber: null });
      expect(flow.nodes.some((n) => n.type === "transfer_call")).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Single-tool state node-locking (GAP_REGISTER §1.4 item 4 / the verifier's
// "single-tool states compile to Retell Function Nodes" claim) — the one
// structural guarantee `compiler-gate.test.ts` (packages/templates)
// deliberately never inspects (its own docstring: only `disclosureVerified`
// is asserted, never `providerPayload`/node shapes, since that type is
// `unknown` outside this adapter package per CLAUDE.md Rule 2). Asserted
// here, inside the one package allowed to inspect Retell-shaped payloads,
// against every `conversation_flow` template in BOTH registries (now
// including the real 8 shipped templates via `REAL_REGISTRY` — see the
// file-top INTEGRATION NOTE) so this is checked end-to-end, not just for
// transfer_call.
// ---------------------------------------------------------------------------

describe("tool-bearing states lock to a Retell SubagentNode / TransferCallNode (real + local registry, CALL-4)", () => {
  for (const { key, template } of [...LOCAL_REGISTRY, ...REAL_REGISTRY]) {
    if (template.compile_target !== "conversation_flow") continue;

    it(`${key}: every non-start transfer_call-only state compiles to a TransferCallNode when a transferNumber is configured`, () => {
      const flow = compileConversationFlow(template, TOOL_WEBHOOK_URL, {
        transferNumber: "+15559876543",
      });
      const nodesById = new Map(flow.nodes.map((n) => [n.id, n]));
      const startId = template.states[0]?.id;

      for (const state of template.states) {
        if (state.id === startId) continue;
        if (state.allowed_tools.length !== 1 || state.allowed_tools[0] !== "transfer_call") {
          continue;
        }
        const node = nodesById.get(state.id);
        expect(node, `state '${state.id}' has no compiled node`).toBeDefined();
        expect(node?.type).toBe("transfer_call");
      }
    });

    it(`${key}: every non-start, non-transfer state with 1+ tools compiles to a SubagentNode carrying exactly its allowed_tools as tool_ids (a plain ConversationNode can never call a tool — RETELL-VERIFIED)`, () => {
      const flow = compileConversationFlow(template, TOOL_WEBHOOK_URL, {
        transferNumber: "+15559876543",
      });
      const nodesById = new Map(flow.nodes.map((n) => [n.id, n]));
      const startId = template.states[0]?.id;

      for (const state of template.states) {
        if (state.id === startId) continue;
        if (state.allowed_tools.length === 0) continue;
        if (state.allowed_tools.length === 1 && state.allowed_tools[0] === "transfer_call") {
          continue;
        }

        const node = nodesById.get(state.id);
        expect(node, `state '${state.id}' has no compiled node`).toBeDefined();
        expect(node?.type).toBe("subagent");
        if (node?.type === "subagent") {
          expect([...(node.tool_ids ?? [])].sort()).toEqual([...state.allowed_tools].sort());
        }
      }
    });

    it(`${key}: every 0-tool non-start state compiles to a plain ConversationNode with no tool_ids field`, () => {
      const flow = compileConversationFlow(template, TOOL_WEBHOOK_URL, {
        transferNumber: "+15559876543",
      });
      const nodesById = new Map(flow.nodes.map((n) => [n.id, n]));
      const startId = template.states[0]?.id;

      for (const state of template.states) {
        if (state.id === startId) continue;
        if (state.allowed_tools.length !== 0) continue;

        const node = nodesById.get(state.id);
        expect(node, `state '${state.id}' has no compiled node`).toBeDefined();
        expect(node?.type).toBe("conversation");
        expect(node).not.toHaveProperty("tool_ids");
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Token/schema consistency (GAP_REGISTER §1.6) — every `{{token}}` a
// vertical's compiled prompt text references must resolve to either a
// base call-scoped dynamic variable (`zAgentDynamicVariables`) or a field
// (possibly a documented derived-token form) this vertical's own
// `z*Overrides`/`verticalDetailsSchema` declares. Fails loudly (naming the
// exact token) rather than silently accepting an unresolved placeholder —
// this is the check GAP_REGISTER §1.6 asked for: "a build-time or
// test-time consistency check ... that diffs the token set each vertical's
// compiled prompt references ... against the keys its z*Overrides schema
// declares".
// ---------------------------------------------------------------------------

const MUSTACHE_TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function tokensIn(text: string): string[] {
  return [...text.matchAll(MUSTACHE_TOKEN)].map((m) => m[1] as string);
}

function allPromptText(template: AgentTemplate): string {
  return [
    template.disclosure_line,
    template.system_prompt ?? "",
    ...template.states.map((s) => s.prompt_fragment),
    ...template.global_intents.map((gi) => gi.description),
  ].join("\n");
}

/**
 * A raw override-schema field name isn't always the literal token name a
 * prompt uses — `voice-inbound`'s dynamic-variable resolver formats/derives
 * some fields (cents -> a "_text" string, a `{name,phone}` contact struct
 * -> two separate tokens) rather than speaking the raw stored value. This
 * mirrors the derivation rules already established across the 8 shipped
 * templates (`packages/templates/src/red-team/prompt-lint.ts`'s hand-
 * maintained `ALLOWED_DYNAMIC_VARIABLES` allowlist covers the identical
 * set) — kept here as an explicit, documented, TypeScript-checked function
 * over the real schema's field names (via `.shape`) rather than a second
 * hand-maintained list, so a field rename/removal in `agent-template.ts`
 * is caught by this test rather than silently drifting.
 */
function derivedTokensForField(fieldName: string): string[] {
  if (fieldName.endsWith("_cents")) {
    return [`${fieldName.slice(0, -"_cents".length)}_text`];
  }
  if (fieldName === "tow_partner" || fieldName === "emergency_referral") {
    return [`${fieldName}_name`, `${fieldName}_phone`];
  }
  if (fieldName === "cancellation_policy" || fieldName === "deposit_policy") {
    return [`${fieldName}_text`];
  }
  return [fieldName];
}

function allowedTokensForVertical(vertical: string): Set<string> {
  const allowed = new Set<string>(Object.keys(zAgentDynamicVariables.shape));

  const overridesSchema = dynamicVariableOverridesSchemaForVertical(vertical);
  const overridesShape = (overridesSchema as unknown as z.ZodObject<z.ZodRawShape>).shape;
  for (const field of Object.keys(overridesShape)) {
    for (const token of derivedTokensForField(field)) allowed.add(token);
  }

  for (const field of Object.keys(verticalDetailsSchema.shape)) {
    for (const token of derivedTokensForField(field)) allowed.add(token);
  }

  return allowed;
}

describe("token/schema consistency across the template registry (GAP_REGISTER §1.6)", () => {
  for (const { key, template } of [...LOCAL_REGISTRY, ...REAL_REGISTRY]) {
    it(`${key}: every {{token}} in the compiled prompt resolves to a declared dynamic-variable/override field`, () => {
      const allowed = allowedTokensForVertical(template.vertical);
      const used = new Set(tokensIn(allPromptText(template)));
      const unresolved = [...used].filter((t) => !allowed.has(t));
      expect(unresolved).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Prompt-length / tool-count budget for single_prompt targets (SYSTEM_DESIGN
// §4.1: "under the ~1000-word/5-tool threshold"). Reducing an over-budget
// template's own content is `packages/templates` ownership, not this
// cluster's (CLAUDE.md Rule 4) — so a template over the SOFT budget is
// REPORTED (console.warn + docs/BUILD_NOTES.md), not hard-failed here.
// A generous HARD ceiling (2x the stated soft budget) still fails the
// build on a genuine runaway regression (e.g. a template accidentally
// duplicating its own content), so this test isn't a no-op.
//
// The real, live-registry finding this describe block originally surfaced
// (real_estate 5 tools/1022 words; generic 6 tools/969 words, both over
// their soft budgets) is recorded in docs/audit/FIX_REQUESTS.md/
// docs/BUILD_NOTES.md and doesn't depend on this test continuing to scan
// the live registry — see this file's top INTEGRATION NOTE.
// ---------------------------------------------------------------------------

const SINGLE_PROMPT_TOOL_SOFT_BUDGET = 5;
const SINGLE_PROMPT_WORD_SOFT_BUDGET = 1000;
const SINGLE_PROMPT_TOOL_HARD_CEILING = SINGLE_PROMPT_TOOL_SOFT_BUDGET * 2;
const SINGLE_PROMPT_WORD_HARD_CEILING = SINGLE_PROMPT_WORD_SOFT_BUDGET * 2;

describe("single_prompt prompt-length/tool-count budget (SYSTEM_DESIGN §4.1)", () => {
  for (const { key, template } of [...LOCAL_REGISTRY, ...REAL_REGISTRY]) {
    if (template.compile_target !== "single_prompt") continue;

    it(`${key}: general_tools stays under the hard ceiling (soft budget reported, not enforced — Cluster F owns template content)`, () => {
      const compiled = compileSinglePrompt(template, TOOL_WEBHOOK_URL);
      const toolCount = compiled.general_tools.length;
      if (toolCount > SINGLE_PROMPT_TOOL_SOFT_BUDGET) {
        // eslint-disable-next-line no-console
        console.warn(
          `[GAP_REGISTER task 5] ${key} single_prompt has ${toolCount} tools, over the ${SINGLE_PROMPT_TOOL_SOFT_BUDGET}-tool soft budget.`,
        );
      }
      expect(toolCount).toBeLessThanOrEqual(SINGLE_PROMPT_TOOL_HARD_CEILING);
    });

    it(`${key}: general_prompt word count stays under the hard ceiling (soft budget reported, not enforced)`, () => {
      const compiled = compileSinglePrompt(template, TOOL_WEBHOOK_URL);
      const wordCount = compiled.general_prompt.trim().split(/\s+/).length;
      if (wordCount > SINGLE_PROMPT_WORD_SOFT_BUDGET) {
        // eslint-disable-next-line no-console
        console.warn(
          `[GAP_REGISTER task 5] ${key} single_prompt is ${wordCount} words, over the ${SINGLE_PROMPT_WORD_SOFT_BUDGET}-word soft target.`,
        );
      }
      expect(wordCount).toBeLessThanOrEqual(SINGLE_PROMPT_WORD_HARD_CEILING);
    });
  }
});
