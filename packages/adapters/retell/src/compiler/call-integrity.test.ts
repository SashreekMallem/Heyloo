/**
 * BEHAVIOR-voice-agent: compiled-agent guarantees over the real shipped
 * registry (`@heyloo/templates`' build artifact, same loader as
 * `registry-consistency.test.ts`). The structural ones (a booking-write node
 * can take a message, a message state cannot be left before take_message
 * succeeded, a leave-a-message path exists from anywhere) are the backstop for
 * the intermittent live failures where an agent said "I've passed your message
 * along" with no tool call.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentTemplate } from "@heyloo/canonical-types";
import { zAgentTemplate } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import {
  CALL_INTEGRITY_INSTRUCTIONS,
  edgeConditionText,
  FALLBACK_DONE_CONDITION,
  LEAVE_MESSAGE_GLOBAL_CONDITION,
  MESSAGE_STATE_EXIT_CONDITION,
  withToolGuidance,
} from "./call-integrity.js";
import { compileConversationFlow } from "./conversation-flow.js";
import { compileMultiPrompt } from "./multi-prompt.js";
import { OWNER_INFO_INSTRUCTIONS } from "./owner-info.js";
import { compileSinglePrompt } from "./single-prompt.js";

const URL_ = "https://example.supabase.co/functions/v1/voice-tools";
const WRITE_TOOLS = ["create_booking", "update_booking", "cancel_booking", "create_order"];

const ARTIFACT = fileURLToPath(
  new URL("../../../../templates/dist/templates.build.json", import.meta.url),
);
if (!existsSync(ARTIFACT)) {
  throw new Error(
    "Run `pnpm --filter @heyloo/templates build` first (see registry-consistency.test.ts).",
  );
}
const REGISTRY = (
  JSON.parse(readFileSync(ARTIFACT, "utf8")) as { templates: { key: string; template: unknown }[] }
).templates.map(({ key, template }) => ({ key, template: zAgentTemplate.parse(template) }));
const FLOWS = REGISTRY.filter((r) => r.template.compile_target === "conversation_flow");

describe("call-integrity rules block", () => {
  it("is part of the compiler-owned block, ahead of the owner-data fence", () => {
    expect(OWNER_INFO_INSTRUCTIONS).toContain(CALL_INTEGRITY_INSTRUCTIONS);
    expect(OWNER_INFO_INSTRUCTIONS.indexOf(CALL_INTEGRITY_INSTRUCTIONS)).toBeLessThan(
      OWNER_INFO_INSTRUCTIONS.lastIndexOf("[[BEGIN OWNER INFO]]"),
    );
  });

  it("forbids claiming a message was taken before take_message returned recorded:true", () => {
    expect(CALL_INTEGRITY_INSTRUCTIONS).toMatch(
      /never say a message was taken, saved or passed along/,
    );
    expect(CALL_INTEGRITY_INSTRUCTIONS).toContain("recorded:true");
    expect(CALL_INTEGRITY_INSTRUCTIONS).toContain('intake_status "partial"');
  });

  for (const { key, template } of REGISTRY) {
    it(`${key}: every compile target's global prompt carries it`, () => {
      for (const target of ["conversation_flow", "multi_prompt", "single_prompt"] as const) {
        const t = { ...template, compile_target: target };
        const text =
          target === "conversation_flow"
            ? (compileConversationFlow(t, URL_).global_prompt ?? "")
            : target === "multi_prompt"
              ? compileMultiPrompt(t, URL_).general_prompt
              : compileSinglePrompt(t, URL_).general_prompt;
        expect(text, `${key} as ${target}`).toContain("recorded:true");
      }
    });
  }
});

describe("conversation-flow structure (F-DENTAL-MSG-1, VCC-1, VCC-4, F3)", () => {
  for (const { key, template } of FLOWS) {
    const flow = compileConversationFlow(template as AgentTemplate, URL_);
    const nodes = new Map(flow.nodes.map((n) => [n.id, n]));

    it(`${key}: every node holding a booking/order write tool can also take a message (Manual Mode must not lose the request)`, () => {
      for (const node of flow.nodes) {
        if (node.type !== "subagent") continue;
        const ids = node.tool_ids ?? [];
        if (ids.some((t) => WRITE_TOOLS.includes(t))) {
          expect(ids, `${key}/${node.id}`).toContain("take_message");
        }
      }
    });

    it(`${key}: the take-a-message state cannot be left before take_message succeeded`, () => {
      const node = nodes.get("take_message_fallback");
      expect(node?.type).toBe("subagent");
      const end =
        node && "edges" in node ? node.edges?.find((e) => e.id.endsWith("_end")) : undefined;
      expect(end?.transition_condition).toEqual({
        type: "prompt",
        prompt: MESSAGE_STATE_EXIT_CONDITION,
      });
      expect(MESSAGE_STATE_EXIT_CONDITION).toContain("recorded:true");
    });

    it(`${key}: a leave-a-message request reaches take_message_fallback from anywhere`, () => {
      const node = nodes.get("take_message_fallback");
      expect(node && "global_node_setting" in node ? node.global_node_setting : undefined).toEqual({
        condition: LEAVE_MESSAGE_GLOBAL_CONDITION,
      });
    });

    it(`${key}: the wrap-up global node does not absorb an unrecorded message`, () => {
      const wrap = nodes.get("__wrap_up");
      const condition =
        wrap && "global_node_setting" in wrap ? (wrap.global_node_setting?.condition ?? "") : "";
      expect(condition).toContain("take_message has not yet recorded");
    });

    it(`${key}: no bare-slug edge condition for the routes that misrouted live calls`, () => {
      const all = flow.nodes.flatMap((n) => ("edges" in n ? (n.edges ?? []) : []));
      for (const e of all) {
        const c = e.transition_condition;
        if (c.type !== "prompt") continue;
        expect(c.prompt).not.toBe("wants_to_reschedule_or_cancel");
        expect(c.prompt).not.toBe("caller_wants_direct_transfer");
        expect(c.prompt).not.toBe("after_hours_or_general_message");
      }
    });
  }

  it("the no-live-transfer fallback exit needs a saved or declined message, not just the offer", () => {
    const vet = FLOWS.find((f) => f.key === "vet");
    expect(vet).toBeDefined();
    const flow = compileConversationFlow(vet?.template as AgentTemplate, URL_);
    const fallback = flow.nodes.find((n) => n.id.endsWith("__no_transfer") && "edges" in n);
    const done =
      fallback && "edges" in fallback
        ? fallback.edges?.find((e) => e.id.endsWith("_fallback_done"))
        : undefined;
    expect(done?.transition_condition).toEqual({ type: "prompt", prompt: FALLBACK_DONE_CONDITION });
    expect(FALLBACK_DONE_CONDITION).toContain("recorded:true");
    expect(FALLBACK_DONE_CONDITION).toContain("declined");
  });
});

describe("edgeConditionText", () => {
  it("expands the ambiguous slugs and passes others through", () => {
    expect(edgeConditionText("wants_to_reschedule_or_cancel")).toMatch(/existing appointment/);
    expect(edgeConditionText("caller_wants_direct_transfer")).toMatch(/asks to be connected/);
    // SPEED-1: a merged details step's exit names everything that step gathers.
    expect(edgeConditionText("slot_selected")).toMatch(/every other detail this step asks for/);
    expect(edgeConditionText("wants_to_book_service")).toBe("wants_to_book_service");
  });
});

describe("compile-time tool guidance", () => {
  const params = (props: Record<string, unknown>, required: string[] = []) => ({
    type: "object" as const,
    properties: props,
    required,
  });

  it("asks for a UTC offset on every time argument", () => {
    const check = withToolGuidance(
      "check_availability",
      "d",
      params({
        date_range: {
          type: "object",
          properties: { start: { type: "string" }, end: { type: "string" } },
        },
      }),
    );
    const range = (
      check.parameters.properties as Record<
        string,
        { properties: Record<string, { description: string }> }
      >
    )["date_range"];
    expect(range?.properties["start"]?.description).toContain("UTC offset");
    expect(range?.properties["end"]?.description).toContain("UTC offset");
    const booking = withToolGuidance("create_booking", "d", params({ start: {}, end: {} }));
    expect(
      (booking.parameters.properties as Record<string, { description: string }>)["start"]
        ?.description,
    ).toContain("UTC offset");
  });

  it("take_message: caller_phone is no longer required and intake_status is offered", () => {
    const g = withToolGuidance(
      "take_message",
      "Record a message.",
      params(
        {
          caller_phone: {},
          message_text: {},
          structured_payload: { type: "object", properties: { matter_type: {} } },
        },
        ["caller_phone", "message_text"],
      ),
    );
    expect(g.parameters.required).toEqual(["message_text"]);
    const sp = (g.parameters.properties as Record<string, { properties: Record<string, unknown> }>)[
      "structured_payload"
    ];
    expect(Object.keys(sp?.properties ?? {})).toEqual(["matter_type", "intake_status"]);
    expect(g.description).toContain("recorded:true");
  });

  it("update_booking: new_end stays schema-required but is documented as ignored (the booking keeps its length)", () => {
    const g = withToolGuidance(
      "update_booking",
      "d",
      params({ booking_id: {}, new_start: {}, new_end: {} }, [
        "booking_id",
        "new_start",
        "new_end",
      ]),
    );
    expect(g.parameters.required).toEqual(["booking_id", "new_start", "new_end"]);
    expect(JSON.stringify(g.parameters)).toContain("original length");
    expect(g.description).toContain("check_availability");
  });

  it("send_sms_confirmation: the template key is a fixed enum", () => {
    const g = withToolGuidance(
      "send_sms_confirmation",
      "d",
      params({ template_key: { type: "string" } }),
    );
    expect(
      (g.parameters.properties as Record<string, { enum: string[] }>)["template_key"]?.enum,
    ).toEqual(["booking_confirmation", "order_confirmation", "booking_cancelled"]);
  });

  it("leaves an unknown tool unchanged", () => {
    const p = params({ x: {} });
    expect(withToolGuidance("mystery", "d", p)).toEqual({ description: "d", parameters: p });
  });
});
