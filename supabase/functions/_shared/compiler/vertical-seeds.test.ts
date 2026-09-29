import { describe, expect, it } from "vitest";
import { AGENT_TEMPLATE_SEEDS } from "../agent-template-seeds.ts";
import {
  CALLER_GREETING_TOKEN,
  type CompiledFlowRequest,
  type CompilerAgentTemplate,
  compileTemplate,
  firstUtterance,
} from "./template-compiler.ts";

/**
 * DISCLOSE-1 (docs/BUILD_NOTES.md): whole-registry guarantees over every
 * shipped vertical template (`agent-template-seeds.ts` — the content every
 * live agent is compiled from), not just the hand-built fixtures in
 * `template-compiler.test.ts`.
 */

const TOOL_WEBHOOK_URL = "https://example.supabase.co/functions/v1/voice-tools";
const COMPILE_TARGETS: CompilerAgentTemplate["compile_target"][] = [
  "conversation_flow",
  "multi_prompt",
  "single_prompt",
];
const VERTICALS = Object.entries(AGENT_TEMPLATE_SEEDS);

/** Every text a compiled agent could be prompted with or speak, tagged by where it lives. */
function textsOf(flow: CompiledFlowRequest): Array<{ where: string; text: string }> {
  const out: Array<{ where: string; text: string }> = [];
  switch (flow.kind) {
    case "conversation_flow":
      out.push({ where: "global_prompt", text: flow.body.global_prompt });
      for (const node of flow.body.nodes) {
        if ("instruction" in node && node.instruction) {
          out.push({ where: `node:${node.id}`, text: node.instruction.text });
        }
      }
      break;
    case "multi_prompt":
      out.push({ where: "general_prompt", text: flow.body.general_prompt });
      for (const state of flow.body.states) {
        out.push({ where: `state:${state.name}`, text: state.state_prompt });
      }
      break;
    case "single_prompt":
      out.push({ where: "general_prompt", text: flow.body.general_prompt });
      break;
  }
  return out;
}

describe("DISCLOSE-1: every vertical x every compile target opens with a STATIC first utterance carrying the disclosure literal verbatim", () => {
  for (const [vertical, seed] of VERTICALS) {
    for (const target of COMPILE_TARGETS) {
      for (const language of ["en", "es"]) {
        it(`${vertical} as ${target} (${language})`, () => {
          const template = { ...seed.content, compile_target: target };
          const compiled = compileTemplate(template, TOOL_WEBHOOK_URL, { language });
          const first = firstUtterance(compiled.flow);

          expect(first.isStatic).toBe(true);
          expect(compiled.openingLine.disclosureLiteral.length).toBeGreaterThan(0);
          expect(first.text.startsWith(compiled.openingLine.disclosureLiteral)).toBe(true);
          expect(first.text).toContain(CALLER_GREETING_TOKEN);
          expect(compiled.disclosureVerified).toBe(true);

          // The literal carries BOTH halves of the disclosure (AI + recording).
          if (compiled.openingLine.language === "en") {
            expect(first.text).toContain(seed.content.disclosure_line);
            expect(first.text).toMatch(/AI assistant/);
            expect(first.text).toMatch(/this call may be recorded/);
          } else {
            expect(first.text).toMatch(/inteligencia artificial/);
            expect(first.text).toMatch(/esta llamada puede ser grabada/);
          }
        });
      }
    }
  }
});

describe("DISCLOSE-1: a compiled agent never claims a transfer that is not happening", () => {
  it("no shipped state tells the model to announce a connection itself", () => {
    const announce =
      /(let (the caller|them) know you're connecting|you're connecting them now|connecting you now)/i;
    for (const [vertical, seed] of VERTICALS) {
      for (const state of seed.content.states) {
        expect(state.prompt_fragment, `${vertical}.${state.id}`).not.toMatch(announce);
      }
    }
  });

  for (const [vertical, seed] of VERTICALS) {
    if (seed.content.compile_target !== "conversation_flow") continue;
    it(`${vertical}: every transfer-only state compiles to a silent router + the only announcing node (the real transfer) + an honest fallback`, () => {
      const compiled = compileTemplate(seed.content, TOOL_WEBHOOK_URL);
      if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
      const nodes = new Map(compiled.flow.body.nodes.map((n) => [n.id, n]));
      const transferOnly = seed.content.states.filter(
        (s) => s.allowed_tools.length === 1 && s.allowed_tools[0] === "transfer_call",
      );
      expect(transferOnly.length).toBeGreaterThan(0);
      for (const state of transferOnly) {
        const router = nodes.get(state.id);
        expect(router?.type).toBe("branch");
        expect(router && "instruction" in router).toBe(false);
        const transfer = nodes.get(`${state.id}__transfer`);
        expect(transfer?.type).toBe("transfer_call");
        const fallback = nodes.get(`${state.id}__no_transfer`);
        const fallbackText =
          fallback && "instruction" in fallback ? (fallback.instruction?.text ?? "") : "";
        expect(fallbackText).toMatch(/There is NO live transfer on this call/);
        expect(fallbackText).toMatch(/restate the emergency referral/);
      }
    });
  }

  for (const [vertical, seed] of VERTICALS) {
    if (seed.content.compile_target === "conversation_flow") continue;
    it(`${vertical} (${seed.content.compile_target}): the transfer_call tool announces itself and the model is forbidden from announcing on its own`, () => {
      const compiled = compileTemplate(seed.content, TOOL_WEBHOOK_URL);
      const texts = textsOf(compiled.flow).map((t) => t.text);
      expect(
        texts.some((t) =>
          t.includes(
            "never tell the caller you are connecting, transferring or putting them through unless you are calling transfer_call in this same turn",
          ),
        ),
      ).toBe(true);
      const tools =
        compiled.flow.kind === "multi_prompt"
          ? compiled.flow.body.states.flatMap((s) => s.tools)
          : compiled.flow.kind === "single_prompt"
            ? compiled.flow.body.general_tools
            : [];
      const transferTools = tools.filter((t) => t.type === "transfer_call");
      expect(transferTools.length).toBeGreaterThan(0);
      for (const tool of transferTools) {
        expect(tool).toMatchObject({
          speak_during_execution: true,
          execution_message_type: "prompt",
        });
      }
    });
  }
});

describe("DISCLOSE-1: vet and dental emergency prompts", () => {
  it("vet: the emergency referral node gives the referral first, only offers a direct connection when {{transfer_number}} is real, and can take the message itself", () => {
    const compiled = compileTemplate(AGENT_TEMPLATE_SEEDS.vet.content, TOOL_WEBHOOK_URL);
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    const referral = compiled.flow.body.nodes.find((n) => n.id === "emergency_referral") as {
      type: string;
      tool_ids?: string[];
      instruction: { text: string };
    };
    expect(referral.type).toBe("subagent");
    expect(referral.tool_ids).toEqual(["take_message"]);
    expect(referral.instruction.text).toContain("{{emergency_referral_name}}");
    expect(referral.instruction.text).toContain("{{transfer_number}}");
    expect(referral.instruction.text).toMatch(
      /If it is blank, never offer, promise or mention connecting them/,
    );
    expect(referral.instruction.text).toMatch(/answer plainly: yes, go now/);
  });

  it("vet: the no-live-transfer branch of the emergency warm transfer restates the referral and takes a message, never 'connecting you'", () => {
    const compiled = compileTemplate(AGENT_TEMPLATE_SEEDS.vet.content, TOOL_WEBHOOK_URL);
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    const fallback = compiled.flow.body.nodes.find(
      (n) => n.id === "emergency_warm_transfer__no_transfer",
    ) as { tool_ids?: string[]; instruction: { text: string } };
    expect(fallback.tool_ids).toEqual(["take_message"]);
    expect(fallback.instruction.text).toContain("go to {{emergency_referral_name}} right now");
    expect(fallback.instruction.text).toMatch(/yes, go now/);
    expect(fallback.instruction.text).toMatch(/Never say or imply that you are connecting/);
  });

  it("dental: the emergency state keeps restating the 911/ER referral, never offers an appointment or a connection, and takes a message", () => {
    const state = AGENT_TEMPLATE_SEEDS.dental.content.states.find(
      (s) => s.id === "safety_emergency",
    );
    expect(state?.allowed_tools).toEqual(["take_message"]);
    expect(state?.prompt_fragment).toMatch(/911/);
    expect(state?.prompt_fragment).toMatch(/restate the same referral plainly every time/);
    expect(state?.prompt_fragment).toMatch(/never offer or promise an appointment/);
    expect(state?.prompt_fragment).toMatch(/call take_message/);
  });
});

describe("DISCLOSE-1: a recognized returning caller is welcomed by name and confirmed, never re-asked", () => {
  for (const [vertical, seed] of VERTICALS) {
    it(`${vertical}: every node/state sees the confirm-don't-re-ask instruction (global prompt)`, () => {
      const compiled = compileTemplate(seed.content, TOOL_WEBHOOK_URL);
      const global = textsOf(compiled.flow)[0];
      expect(global?.where).toMatch(/global_prompt|general_prompt/);
      expect(global?.text).toContain("{{caller_name_on_file}}");
      expect(global?.text).toContain("{{caller_phone_on_file}}");
      expect(global?.text).toMatch(/never ask a recognized caller to tell you their name or phone/);
    });
  }
});
