import { describe, expect, it } from "vitest";
import { MULTI_ENTITY_FRAGMENT } from "./shared/fragments.js";
import { createOrderTool } from "./shared/tools.js";
import { manageBookingState, takeMessageFallbackState } from "./shared/utility-states.js";
import { AUTO_REPAIR_TEMPLATE } from "./verticals/auto-repair.js";
import { LEGAL_TEMPLATE } from "./verticals/legal.js";
import { RESTAURANT_TEMPLATE } from "./verticals/restaurant.js";
import { VETERINARY_TEMPLATE } from "./verticals/veterinary.js";

/**
 * BEHAVIOR-voice-agent: the wording that makes a message durable and stops the
 * model echoing prompt examples as if they were caller data (F-DENTAL-MSG-1,
 * F-HALLU-1, F-LEGAL-*, F-VET-EMERG-1). The compiler-owned rules are tested in
 * `packages/adapters/retell/src/compiler/call-integrity.test.ts`.
 */

const state = (t: { states: { id: string; prompt_fragment: string }[] }, id: string) => {
  const s = t.states.find((x) => x.id === id);
  if (!s) throw new Error(`no state ${id}`);
  return s;
};

describe("take-a-message wording", () => {
  it("tells the model to CALL take_message and only then say the message is recorded", () => {
    const text = takeMessageFallbackState().prompt_fragment;
    expect(text).toContain("CALL take_message");
    expect(text).toContain("recorded:true");
    expect(text).toMatch(/never say you passed a message along without having called take_message/);
  });

  it("no longer promises a callback time it has no data for", () => {
    const text = takeMessageFallbackState().prompt_fragment;
    expect(text).not.toMatch(/when to expect a call back/);
    expect(text).toMatch(/Do not promise a callback time/);
  });

  it("the vet emergency message step also requires the tool call", () => {
    const text = state(VETERINARY_TEMPLATE, "emergency_take_message").prompt_fragment;
    expect(text).toContain("CALL take_message");
    expect(text).toContain("recorded:true");
  });

  it("the vet emergency step moves straight to the transfer when the caller asks to be connected", () => {
    const text = state(VETERINARY_TEMPLATE, "emergency_referral").prompt_fragment;
    expect(text).toMatch(/asks to be connected/);
    expect(text).toMatch(/move straight to the direct-transfer step/);
  });
});

describe("no real-looking example data in prompts (F-HALLU-1)", () => {
  it("uses placeholders, not Bella / a 2019 Civic", () => {
    const all = [
      MULTI_ENTITY_FRAGMENT,
      state(VETERINARY_TEMPLATE, "booking_details").prompt_fragment,
      state(AUTO_REPAIR_TEMPLATE, "booking_details").prompt_fragment,
    ].join("\n");
    expect(all).not.toMatch(/Bella|2019/);
    expect(all).toContain("<pet name from lookup_customer>");
    expect(MULTI_ENTITY_FRAGMENT).toMatch(/placeholders, never real data/);
  });
});

describe("manage_booking (VCC-2, F-AUTO-RESCHED-1, VCC-5)", () => {
  it("answers status questions from lookup_customer, reads the booking back and checks availability first", () => {
    const text = manageBookingState().prompt_fragment;
    expect(text).toContain("start_local");
    expect(text).toMatch(/never say they have no appointment unless lookup_customer returned none/);
    expect(text).toMatch(/read back the exact local date, time and service/);
    expect(text).toMatch(/call check_availability for the new time first/);
  });
});

describe("legal", () => {
  it("a transfer records a partial intake and never keeps the caller waiting", () => {
    const text = state(LEGAL_TEMPLATE, "transfer_to_human").prompt_fragment;
    expect(text).toContain('intake_status to "partial"');
    expect(text).toMatch(/never keep them waiting/);
  });

  it("has a cancel/reschedule state that records a request and never says cancelled", () => {
    const s = state(LEGAL_TEMPLATE, "cancel_or_reschedule_request");
    expect(s.prompt_fragment).toMatch(/never say anything is cancelled, rescheduled or confirmed/);
    expect(s.prompt_fragment).toContain('intake_status "partial"');
    expect(s.prompt_fragment).toMatch(/do not ask the intake or conflict-check questions/);
    expect(
      LEGAL_TEMPLATE.states.find((x) => x.id === "cancel_or_reschedule_request")?.allowed_tools,
    ).toEqual(["take_message"]);
    expect(
      LEGAL_TEMPLATE.transitions.some(
        (t) => t.from === "greeting" && t.to === "cancel_or_reschedule_request",
      ),
    ).toBe(true);
  });

  it("intake completion is a request, not a confirmed appointment", () => {
    const text = state(LEGAL_TEMPLATE, "intake_complete").prompt_fragment;
    expect(text).toMatch(/request, not a confirmed appointment/);
    expect(text).toMatch(/do not read out a cancellation policy/);
  });

  it("early wrap-up and the labeled-line fragment mark an incomplete intake partial instead of inventing values", () => {
    expect(state(LEGAL_TEMPLATE, "intake").prompt_fragment).toContain('intake_status to "partial"');
    expect(LEGAL_TEMPLATE.system_prompt).toContain('"Not yet asked" belongs only in message_text');
  });
});

describe("restaurant orders use the menu's exact item names (live QA 2026-09-30)", () => {
  it("the agent maps a caller's wording to a menu item itself and orders by the exact menu name", () => {
    const prompt = RESTAURANT_TEMPLATE.system_prompt;
    expect(prompt).toMatch(/work out which menu item\s+they mean yourself/);
    expect(prompt).toMatch(
      /exact name as written in the menu to create_order, never the caller's own wording/,
    );
    expect(prompt).toMatch(/if more than one fits, name the options and ask which one/);
    expect(prompt).toMatch(/item_not_found, it lists the menu's real item names \(menu_items\)/);
  });

  it("the create_order tool asks for the exact menu name", () => {
    const tool = createOrderTool();
    expect(tool.description).toMatch(/exact name as written in the menu/);
    const items = (
      tool.parameters.properties as Record<
        string,
        { items?: { properties?: Record<string, { description?: string }> } }
      >
    )["items"];
    expect(items?.items?.properties?.["name"]?.description).toMatch(
      /exact name as written in the menu/,
    );
  });
});
