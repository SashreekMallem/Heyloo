import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { DispatchDeps } from "./handler.ts";
import { dispatchTool, isKnownTool } from "./handler.ts";

const logger = createLogger();

function makeDeps(callContextRow: unknown, extra: Record<string, unknown[]> = {}): DispatchDeps {
  const sql = ((strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    if (text.includes("from public.call_logs") && text.includes("retell_call_id")) {
      return Promise.resolve(callContextRow ? [callContextRow] : []);
    }
    for (const [key, rows] of Object.entries(extra)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return {
    sql,
    logger,
    paymentLink: {
      fetchImpl: () => Promise.reject(new Error("not used in this test")),
      stripeSecretKey: "sk_test",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    },
  };
}

describe("isKnownTool", () => {
  it("recognizes every spec'd tool name", () => {
    for (const name of [
      "check_availability",
      "create_booking",
      "update_booking",
      "cancel_booking",
      "lookup_customer",
      "take_message",
      "send_sms_confirmation",
      "create_order",
      "send_payment_link",
    ]) {
      expect(isKnownTool(name)).toBe(true);
    }
  });

  it("rejects an unrecognized tool name", () => {
    expect(isKnownTool("delete_everything")).toBe(false);
  });
});

describe("dispatchTool", () => {
  it("returns the graceful fallback when the call context cannot be resolved (never a raw error)", async () => {
    const deps = makeDeps(null);
    const result = await dispatchTool(deps, "call_missing", "check_availability", {
      date_range: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
    });
    expect(result).toEqual({
      result: { fallback: true, message: "I'll take your details and have someone confirm." },
    });
  });

  it("returns the graceful fallback for an unrecognized tool name rather than an error", async () => {
    const deps = makeDeps({ id: "cl1", tenant_id: "t1", caller_number: "+15551234567" });
    const result = await dispatchTool(deps, "call_1", "not_a_real_tool", {});
    expect(result.result).toMatchObject({ fallback: true });
  });

  it("returns the graceful fallback when args fail Zod validation, never throwing", async () => {
    const deps = makeDeps({ id: "cl1", tenant_id: "t1", caller_number: "+15551234567" });
    const result = await dispatchTool(deps, "call_1", "check_availability", {
      date_range: "not an object",
    });
    expect(result.result).toMatchObject({ fallback: true });
  });

  it("routes check_availability through to a real tool result on valid input", async () => {
    const deps = makeDeps(
      { id: "cl1", tenant_id: "t1", caller_number: "+15551234567" },
      { "from public.availability_slots": [] },
    );
    const result = await dispatchTool(deps, "call_1", "check_availability", {
      date_range: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
    });
    expect(result.result).toMatchObject({ none_available: true });
  });

  it("routes lookup_customer through with the G6 caller-scope check intact", async () => {
    const deps = makeDeps({ id: "cl1", tenant_id: "t1", caller_number: "+15551234567" });
    const result = await dispatchTool(deps, "call_1", "lookup_customer", { phone: "+15559998888" });
    expect(result).toEqual({ result: { error: "unauthorized_lookup" } });
  });
});
