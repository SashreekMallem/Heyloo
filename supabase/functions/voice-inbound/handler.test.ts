import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import { VoiceInboundRequestSchema } from "../_shared/schemas/voice-inbound.ts";
import type { SqlClient } from "../_shared/types.ts";
import { handleVoiceInbound } from "./handler.ts";

// Nested shape confirmed live (LIVE-MINE-FIXES, docs/VERIFY.md VERIFY-2):
// Retell's real `call_inbound` webhook body wraps from_number/to_number
// under `call_inbound`, with no call_id anywhere.
function inboundRequest(from_number: string, to_number: string) {
  return { event: "call_inbound", call_inbound: { from_number, to_number } };
}

const NOW = new Date("2026-01-12T14:00:00.000Z"); // Monday 09:00 EST

const BASE_ROW = {
  tenant_id: "tenant_1",
  business_name: "Acme Auto Repair",
  vertical: "auto",
  timezone: "America/New_York",
  business_hours: { mon: [{ open: "08:00", close: "18:00" }] },
  hours_exceptions: [],
  manual_mode: false,
  language_primary: "en",
  assistant_name: "Riley",
  special_instructions: "Ask about the vehicle's mileage.",
  dynamic_variable_overrides: {},
  retell_agent_id: "agent_abc",
  disclosure_line:
    "Hi, this is Riley, the AI assistant for Acme Auto Repair — this call may be recorded.",
  transfer_number: "+15550001111",
};

function makeSql(responses: unknown[][]): SqlClient {
  let call = 0;
  return (() => {
    const result = responses[call] ?? [];
    call += 1;
    return Promise.resolve(result);
  }) as SqlClient;
}

const logger = createLogger();

describe("handleVoiceInbound", () => {
  it("returns 404 when the to_number normalizes to nothing", async () => {
    const sql = makeSql([]);
    const result = await handleVoiceInbound({
      sql,
      request: inboundRequest("+15551234567", "bad-number"),
      logger,
      now: NOW,
    });
    expect(result.status).toBe(404);
  });

  it("returns 404 when no phone_numbers row matches (unprovisioned number)", async () => {
    const sql = makeSql([[]]);
    const result = await handleVoiceInbound({
      sql,
      request: inboundRequest("+15551234567", "+15559998888"),
      logger,
      now: NOW,
    });
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: "number_not_found" });
  });

  it("returns the compiled dynamic variables on a successful match", async () => {
    const sql = makeSql([[BASE_ROW], []]);
    const result = await handleVoiceInbound({
      sql,
      request: inboundRequest("+15551234567", "+15559998888"),
      logger,
      now: NOW,
    });
    expect(result.status).toBe(200);
    if (result.status !== 200) throw new Error("unreachable");
    expect(result.body.call_inbound.override_agent_id).toBe("agent_abc");
    expect(result.body.call_inbound.dynamic_variables).toMatchObject({
      business_name: "Acme Auto Repair",
      assistant_name: "Riley",
      greeting_hours_context: "We're open until 6 PM.",
      timezone: "America/New_York",
      is_manual_mode: false,
      language: "en",
      disclosure_line: BASE_ROW.disclosure_line,
      transfer_number: "+15550001111",
      // CALL-6 (docs/BUILD_NOTES.md): NOW is Monday 2026-01-12 America/
      // New_York — the next 7 calendar days, tenant-timezone-local.
      upcoming_weekday_dates:
        "Tuesday=2026-01-13, Wednesday=2026-01-14, Thursday=2026-01-15, " +
        "Friday=2026-01-16, Saturday=2026-01-17, Sunday=2026-01-18, Monday=2026-01-19",
    });
    // CALL-9: no matching customers row — ALWAYS a real sentence now
    // (never omitted), so `{{caller_recent_context}}` in the compiled
    // prompt is never left as a literal unresolved placeholder.
    expect(result.body.call_inbound.dynamic_variables.caller_recent_context).toBe(
      "This is a new caller — no prior history is on file; collect their name and phone number normally.",
    );
  });

  it("PUBLISH-1 (was FIX_REQUESTS.md): sends transfer_number as an empty string (never omitted) when agent_configs.transfer_number is unset — every compiled flow now literally embeds {{transfer_number}}, so an omitted key would leave a literal unresolved placeholder instead of a real empty value", async () => {
    const sql = makeSql([[{ ...BASE_ROW, transfer_number: null }], []]);
    const result = await handleVoiceInbound({
      sql,
      request: inboundRequest("+15551234567", "+15559998888"),
      logger,
      now: NOW,
    });
    expect(result.status).toBe(200);
    if (result.status !== 200) throw new Error("unreachable");
    expect(result.body.call_inbound.dynamic_variables.transfer_number).toBe("");
  });

  it("includes caller_recent_context for a known returning caller (G28)", async () => {
    const sql = makeSql([
      [BASE_ROW],
      [{ name: "Jordan Lee", last_seen_at: "2026-01-01T00:00:00Z", lifetime_bookings: 3 }],
    ]);
    const result = await handleVoiceInbound({
      sql,
      request: inboundRequest("+15551234567", "+15559998888"),
      logger,
      now: NOW,
    });
    if (result.status !== 200) throw new Error("unreachable");
    expect(result.body.call_inbound.dynamic_variables.caller_recent_context).toBe(
      "Jordan has booked with us before.",
    );
  });

  it("falls back to a generic assistant name when none is configured", async () => {
    const row = {
      ...BASE_ROW,
      assistant_name: null,
      special_instructions: null,
      retell_agent_id: null,
    };
    const sql = makeSql([[row], []]);
    const result = await handleVoiceInbound({
      sql,
      request: inboundRequest("+15551234567", "+15559998888"),
      logger,
      now: NOW,
    });
    if (result.status !== 200) throw new Error("unreachable");
    expect(result.body.call_inbound.override_agent_id).toBeUndefined();
    expect(result.body.call_inbound.dynamic_variables.assistant_name).toBe("the AI assistant");
    expect(result.body.call_inbound.dynamic_variables.special_instructions).toBe("");
  });

  it("surfaces dynamic_variable_overrides fields (manager/parking/payment types)", async () => {
    const row = {
      ...BASE_ROW,
      dynamic_variable_overrides: {
        manager_name: "Sam",
        manager_phone: "+15550001111",
        parking_info: "Free lot behind the building.",
        accessibility_notes: "Ramp at the side entrance.",
        accepted_payment_types: ["cash", "card"],
      },
    };
    const sql = makeSql([[row], []]);
    const result = await handleVoiceInbound({
      sql,
      request: inboundRequest("+15551234567", "+15559998888"),
      logger,
      now: NOW,
    });
    if (result.status !== 200) throw new Error("unreachable");
    expect(result.body.call_inbound.dynamic_variables).toMatchObject({
      manager_name: "Sam",
      manager_phone: "+15550001111",
      parking_info: "Free lot behind the building.",
      accessibility_notes: "Ramp at the side entrance.",
      accepted_payment_types: ["cash", "card"],
    });
  });

  it("every response includes a resolved cancellation_policy_text, never a missing/blank token", async () => {
    const sql = makeSql([[BASE_ROW], []]);
    const result = await handleVoiceInbound({
      sql,
      request: inboundRequest("+15551234567", "+15559998888"),
      logger,
      now: NOW,
    });
    if (result.status !== 200) throw new Error("unreachable");
    expect(result.body.call_inbound.dynamic_variables.cancellation_policy_text).toBeTruthy();
  });
});

describe("handleVoiceInbound — per-vertical dynamic_variable_overrides (GAP_REGISTER §1.3)", () => {
  it("auto: resolves the tow-partner referral fixture from overrides", async () => {
    const row = {
      ...BASE_ROW,
      vertical: "auto",
      dynamic_variable_overrides: {
        tow_partner: { name: "Ace Towing", phone: "+15555551234" },
        vehicle_makes_serviced: ["Toyota", "Honda", "Ford"],
      },
    };
    const sql = makeSql([[row], []]);
    const result = await handleVoiceInbound({
      sql,
      request: inboundRequest("+15551234567", "+15559998888"),
      logger,
      now: NOW,
    });
    if (result.status !== 200) throw new Error("unreachable");
    expect(result.body.call_inbound.dynamic_variables).toMatchObject({
      tow_partner_name: "Ace Towing",
      tow_partner_phone: "+15555551234",
      vehicle_makes_serviced: "Toyota, Honda, and Ford",
    });
  });

  it("auto: never leaves an unresolved tow-partner placeholder when unconfigured", async () => {
    const row = { ...BASE_ROW, vertical: "auto", dynamic_variable_overrides: {} };
    const sql = makeSql([[row], []]);
    const result = await handleVoiceInbound({
      sql,
      request: inboundRequest("+15551234567", "+15559998888"),
      logger,
      now: NOW,
    });
    if (result.status !== 200) throw new Error("unreachable");
    const vars = result.body.call_inbound.dynamic_variables;
    expect(vars.tow_partner_name).not.toMatch(/\{\{/);
    expect(vars.tow_partner_phone).not.toMatch(/\{\{/);
  });

  it("legal: resolves the consult-fee guardrail fixture, formatted as dollars", async () => {
    const row = {
      ...BASE_ROW,
      vertical: "legal",
      dynamic_variable_overrides: {
        practice_areas: ["family law", "estate planning"],
        consult_fee_cents: 25000,
      },
    };
    const sql = makeSql([[row], []]);
    const result = await handleVoiceInbound({
      sql,
      request: inboundRequest("+15551234567", "+15559998888"),
      logger,
      now: NOW,
    });
    if (result.status !== 200) throw new Error("unreachable");
    expect(result.body.call_inbound.dynamic_variables).toMatchObject({
      practice_areas: "family law and estate planning",
      consult_fee_text: "$250.00 for an initial consultation",
    });
  });

  it("motel: resolves the rate-quote-from-table fixture in dollars/night", async () => {
    const row = {
      ...BASE_ROW,
      vertical: "motel",
      dynamic_variable_overrides: {
        rate_table: [
          { room_type: "Standard", nightly_rate_cents: 8900 },
          { room_type: "Suite", nightly_rate_cents: 12900 },
        ],
        deposit_policy: { required: true, text: "A $50 deposit is required to hold your room." },
      },
    };
    const sql = makeSql([[row], []]);
    const result = await handleVoiceInbound({
      sql,
      request: inboundRequest("+15551234567", "+15559998888"),
      logger,
      now: NOW,
    });
    if (result.status !== 200) throw new Error("unreachable");
    expect(result.body.call_inbound.dynamic_variables).toMatchObject({
      rate_table: "Standard: $89.00/night; Suite: $129.00/night",
      deposit_policy_text: "A $50 deposit is required to hold your room.",
    });
  });

  it("motel: an unconfigured rate table never invents a rate (rate-discipline guardrail)", async () => {
    const row = { ...BASE_ROW, vertical: "motel", dynamic_variable_overrides: {} };
    const sql = makeSql([[row], []]);
    const result = await handleVoiceInbound({
      sql,
      request: inboundRequest("+15551234567", "+15559998888"),
      logger,
      now: NOW,
    });
    if (result.status !== 200) throw new Error("unreachable");
    expect(result.body.call_inbound.dynamic_variables.rate_table).toMatch(/no rates on file/);
  });

  it("vet: resolves species_treated and the emergency referral fixture", async () => {
    const row = {
      ...BASE_ROW,
      vertical: "vet",
      dynamic_variable_overrides: {
        species_treated: ["dogs", "cats"],
        emergency_referral: { name: "Metro Animal ER", phone: "+15555559999" },
      },
    };
    const sql = makeSql([[row], []]);
    const result = await handleVoiceInbound({
      sql,
      request: inboundRequest("+15551234567", "+15559998888"),
      logger,
      now: NOW,
    });
    if (result.status !== 200) throw new Error("unreachable");
    expect(result.body.call_inbound.dynamic_variables).toMatchObject({
      species_treated: "dogs and cats",
      emergency_referral_name: "Metro Animal ER",
      emergency_referral_phone: "+15555559999",
    });
  });

  it("restaurant: uses the tenant's menu_text override without an extra offerings query", async () => {
    const row = {
      ...BASE_ROW,
      vertical: "restaurant",
      dynamic_variable_overrides: { menu_text: "Ask your server for today's specials." },
    };
    const sql = makeSql([[row], []]);
    const result = await handleVoiceInbound({
      sql,
      request: inboundRequest("+15551234567", "+15559998888"),
      logger,
      now: NOW,
    });
    if (result.status !== 200) throw new Error("unreachable");
    expect(result.body.call_inbound.dynamic_variables.menu_text).toBe(
      "Ask your server for today's specials.",
    );
  });

  it("restaurant: renders menu_text from active offerings (tax computation itself stays in create_order.ts, not spoken here)", async () => {
    const row = { ...BASE_ROW, vertical: "restaurant", dynamic_variable_overrides: {} };
    const sql = makeSql([
      [row],
      [],
      [
        { name: "Cheeseburger", price_cents: 999 },
        { name: "Fries", price_cents: 350 },
      ],
    ]);
    const result = await handleVoiceInbound({
      sql,
      request: inboundRequest("+15551234567", "+15559998888"),
      logger,
      now: NOW,
    });
    if (result.status !== 200) throw new Error("unreachable");
    expect(result.body.call_inbound.dynamic_variables.menu_text).toBe(
      "Cheeseburger ($9.99); Fries ($3.50)",
    );
  });

  it("dental/generic/real_estate tenants never receive another vertical's tokens", async () => {
    const row = {
      ...BASE_ROW,
      vertical: "real_estate",
      dynamic_variable_overrides: {
        tow_partner: { name: "should not leak", phone: "+15551112222" },
      },
    };
    const sql = makeSql([[row], []]);
    const result = await handleVoiceInbound({
      sql,
      request: inboundRequest("+15551234567", "+15559998888"),
      logger,
      now: NOW,
    });
    if (result.status !== 200) throw new Error("unreachable");
    expect(result.body.call_inbound.dynamic_variables.tow_partner_name).toBeUndefined();
  });
});

describe("VoiceInboundRequestSchema (VERIFY-2, LIVE-MINE-FIXES regression)", () => {
  it("accepts Retell's real nested call_inbound envelope, with no call_id at all", () => {
    const parsed = VoiceInboundRequestSchema.safeParse({
      event: "call_inbound",
      call_inbound: { from_number: "+15551234567", to_number: "+15559998888" },
    });
    expect(parsed.success).toBe(true);
  });

  it("no longer requires the flat legacy-assumed shape (call_id/from_number/to_number at the top level)", () => {
    // This is exactly the body the OLD schema required — it must now be
    // REJECTED (no call_inbound wrapper), proving the flat shape isn't what
    // gates a valid request anymore.
    const flatLegacyShape = {
      call_id: "call_1",
      from_number: "+15551234567",
      to_number: "+15559998888",
    };
    expect(VoiceInboundRequestSchema.safeParse(flatLegacyShape).success).toBe(false);
  });

  it("rejects a call_inbound wrapper missing from_number/to_number", () => {
    const parsed = VoiceInboundRequestSchema.safeParse({
      event: "call_inbound",
      call_inbound: { from_number: "+15551234567" },
    });
    expect(parsed.success).toBe(false);
  });
});
