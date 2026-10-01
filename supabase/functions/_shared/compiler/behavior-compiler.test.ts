import { describe, expect, it } from "vitest";
import { AGENT_TEMPLATE_SEEDS } from "../agent-template-seeds.ts";
import {
  AGENT_COMPILER_VERSION,
  type CompiledFlowRequest,
  type CompilerAgentTemplate,
  compileTemplate,
  OWNER_INFO_INSTRUCTIONS,
} from "./template-compiler.ts";

/**
 * BEHAVIOR-voice-agent: the guarantees the live QA rounds found missing,
 * asserted over the content every deployed agent is compiled from
 * (`agent-template-seeds.ts`) — the Node twin is
 * `packages/adapters/retell/src/compiler/call-integrity.test.ts`.
 */

const URL_ = "https://example.supabase.co/functions/v1/voice-tools";
const WRITE_TOOLS = ["create_booking", "update_booking", "cancel_booking", "create_order"];
const SEEDS = Object.entries(AGENT_TEMPLATE_SEEDS);
const FLOW_SEEDS = SEEDS.filter(([, s]) => s.content.compile_target === "conversation_flow");

function compileAs(
  template: CompilerAgentTemplate,
  target: CompilerAgentTemplate["compile_target"],
) {
  return compileTemplate({ ...template, compile_target: target }, URL_).flow;
}

function edgePrompt(e: { transition_condition: { type: string; prompt?: string } }): string {
  return e.transition_condition.type === "prompt" ? (e.transition_condition.prompt ?? "") : "";
}

function promptOf(flow: CompiledFlowRequest): string {
  return flow.kind === "conversation_flow" ? flow.body.global_prompt : flow.body.general_prompt;
}

describe("AGENT_COMPILER_VERSION", () => {
  it("is 5 (the portal flags agents published before the DELIVERY-1 restaurant address check)", () => {
    expect(AGENT_COMPILER_VERSION).toBe(5);
  });
});

describe("call-integrity rules reach every vertical and every compile target", () => {
  for (const [vertical, seed] of SEEDS) {
    it(`${vertical}: never claims a message was taken before take_message returned recorded:true`, () => {
      for (const target of ["conversation_flow", "multi_prompt", "single_prompt"] as const) {
        const text = promptOf(compileAs(seed.content, target));
        expect(text, `${vertical} as ${target}`).toContain(
          "never say a message was taken, saved or passed along",
        );
        expect(text).toContain("recorded:true");
        expect(text).toContain("[[BEGIN OWNER INFO]]");
      }
      expect(OWNER_INFO_INSTRUCTIONS.lastIndexOf("Call integrity rules")).toBeLessThan(
        OWNER_INFO_INSTRUCTIONS.lastIndexOf("[[BEGIN OWNER INFO]]"),
      );
    });
  }
});

describe("conversation-flow verticals cannot lose a message or a request", () => {
  for (const [vertical, seed] of FLOW_SEEDS) {
    const flow = compileAs(seed.content, "conversation_flow");
    if (flow.kind !== "conversation_flow") throw new Error("expected a conversation flow");
    const nodes = flow.body.nodes;

    it(`${vertical}: a node holding a booking/order write tool can also take a message (VCC-1)`, () => {
      for (const node of nodes) {
        if (node.type !== "subagent") continue;
        const ids = node.tool_ids ?? [];
        if (ids.some((t) => WRITE_TOOLS.includes(t))) {
          expect(ids, `${vertical}/${node.id}`).toContain("take_message");
        }
      }
    });

    it(`${vertical}: take_message_fallback is left only after take_message succeeded or the caller declined (F-DENTAL-MSG-1)`, () => {
      const node = nodes.find((n) => n.id === "take_message_fallback");
      expect(node?.type).toBe("subagent");
      const exit =
        node && "edges" in node ? node.edges?.find((e) => e.id.endsWith("_end")) : undefined;
      expect(exit ? edgePrompt(exit) : "").toContain("recorded:true");
      expect(exit ? edgePrompt(exit) : "").toContain("declined");
    });

    it(`${vertical}: a leave-a-message request reaches take_message_fallback from any node (F3)`, () => {
      const node = nodes.find((n) => n.id === "take_message_fallback");
      const condition =
        node && "global_node_setting" in node ? node.global_node_setting?.condition : undefined;
      expect(condition).toMatch(/asks to leave a message/);
    });

    it(`${vertical}: the wrap-up global node does not absorb an unrecorded message (F3)`, () => {
      const wrap = nodes.find((n) => n.id === "__wrap_up");
      const condition =
        wrap && "global_node_setting" in wrap ? (wrap.global_node_setting?.condition ?? "") : "";
      expect(condition).toContain("take_message has not yet recorded");
    });

    it(`${vertical}: the no-live-transfer fallback cannot end the call on the offer alone (VCC-4)`, () => {
      for (const node of nodes) {
        if (!node.id.endsWith("__no_transfer") || !("edges" in node)) continue;
        const done = node.edges?.find((e) => e.id.endsWith("_fallback_done"));
        if (!done) continue;
        expect(edgePrompt(done)).toContain("recorded:true");
        expect(edgePrompt(done)).toContain("declined");
        expect(edgePrompt(done)).not.toMatch(/offered to take a message at least once/);
      }
    });

    it(`${vertical}: the ambiguous edge slugs are spelled out (F-VET-EMERG-1, VCC-5)`, () => {
      for (const node of nodes) {
        for (const e of "edges" in node ? (node.edges ?? []) : []) {
          const p = edgePrompt(e);
          expect(p).not.toBe("wants_to_reschedule_or_cancel");
          expect(p).not.toBe("caller_wants_direct_transfer");
        }
      }
    });
  }
});

describe("compile-time tool guidance (F1, F4, F8, F-AUTO-RESCHED-1)", () => {
  it("every vertical's tools ask for a UTC offset, make take_message partial-able and fix the SMS keys", () => {
    for (const [vertical, seed] of SEEDS) {
      const flow = compileAs(seed.content, "conversation_flow");
      if (flow.kind !== "conversation_flow") throw new Error("expected a conversation flow");
      const byName = new Map(flow.body.tools.map((t) => [t.name, t]));
      const params = (name: string) =>
        (byName.get(name)?.parameters ?? {}) as {
          required?: string[];
          properties?: Record<string, Record<string, unknown>>;
        };
      if (byName.has("check_availability")) {
        expect(JSON.stringify(byName.get("check_availability")?.parameters), vertical).toContain(
          "UTC offset",
        );
      }
      expect(params("take_message").required ?? [], vertical).not.toContain("caller_phone");
      expect(
        Object.keys(
          (params("take_message").properties?.["structured_payload"]?.["properties"] ??
            {}) as object,
        ),
      ).toContain("intake_status");
      if (byName.has("update_booking")) {
        expect(JSON.stringify(params("update_booking")), vertical).toContain("original length");
      }
      if (byName.has("send_sms_confirmation")) {
        expect(params("send_sms_confirmation").properties?.["template_key"]?.["enum"]).toEqual([
          "booking_confirmation",
          "order_confirmation",
          "booking_cancelled",
        ]);
      }
    }
  });
});

describe("the deployed template copy carries the same wording fixes (agent-template-seeds.ts)", () => {
  const stateText = (vertical: string, id: string): string =>
    AGENT_TEMPLATE_SEEDS[vertical as keyof typeof AGENT_TEMPLATE_SEEDS].content.states.find(
      (s) => s.id === id,
    )?.prompt_fragment ?? "";

  it("every take-a-message state makes the model call take_message before saying it is recorded", () => {
    for (const [vertical, seed] of SEEDS) {
      if (!seed.content.states.some((s) => s.id === "take_message_fallback")) continue;
      const text = stateText(vertical, "take_message_fallback");
      expect(text, vertical).toContain("CALL take_message");
      expect(text, vertical).toContain("recorded:true");
      expect(text, vertical).not.toMatch(/when to expect a call back/);
    }
  });

  it("vet emergency message step and direct-transfer hand-off", () => {
    expect(stateText("vet", "emergency_take_message")).toContain("CALL take_message");
    expect(stateText("vet", "emergency_referral")).toMatch(
      /move straight to the direct-transfer step/,
    );
  });

  it("no real-looking example pet or vehicle in any prompt", () => {
    for (const [vertical, seed] of SEEDS) {
      const all = [
        seed.content.system_prompt ?? "",
        ...seed.content.states.map((s) => s.prompt_fragment),
      ].join("\n");
      expect(all, vertical).not.toMatch(/Bella|2019 Civic|2019 Honda Civic/);
    }
  });

  it("manage_booking reads the booking back, checks availability and answers status questions from a lookup", () => {
    for (const [vertical, seed] of SEEDS) {
      if (!seed.content.states.some((s) => s.id === "manage_booking")) continue;
      const text = stateText(vertical, "manage_booking");
      expect(text, vertical).toContain("start_local");
      expect(text, vertical).toMatch(/call check_availability for the new time first/);
    }
  });

  it("legal: partial intake on transfer, a cancel/reschedule request state, request-not-appointment wording", () => {
    expect(stateText("legal", "transfer_to_human")).toContain('intake_status to "partial"');
    expect(stateText("legal", "cancel_or_reschedule_request")).toMatch(
      /never say anything is cancelled, rescheduled or confirmed/,
    );
    expect(stateText("legal", "intake_complete")).toMatch(/request, not a confirmed appointment/);
    const legal = AGENT_TEMPLATE_SEEDS.legal.content;
    expect(
      legal.transitions.some(
        (t) => t.from === "greeting" && t.to === "cancel_or_reschedule_request",
      ),
    ).toBe(true);
    expect(legal.system_prompt).toContain('"Not yet asked" belongs only in message_text');
  });
});
