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
    });
    expect(result.body.call_inbound.dynamic_variables.caller_recent_context).toBeUndefined();
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
