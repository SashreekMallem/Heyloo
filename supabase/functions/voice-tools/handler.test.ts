import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { DispatchDeps } from "./handler.ts";
import { dispatchTool, isKnownTool, resolveEnvelopeCallId } from "./handler.ts";

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
    dentalIntake: { appBaseUrl: "https://app.example.com" },
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
      "join_waitlist",
      "list_offerings",
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
    const result = await dispatchTool(deps, "call_0123456789abcdef01234567", "not_a_real_tool", {});
    expect(result.result).toMatchObject({ fallback: true });
  });

  it("returns the graceful fallback when args fail Zod validation, never throwing", async () => {
    const deps = makeDeps({ id: "cl1", tenant_id: "t1", caller_number: "+15551234567" });
    const result = await dispatchTool(deps, "call_0123456789abcdef01234567", "check_availability", {
      date_range: "not an object",
    });
    expect(result.result).toMatchObject({ fallback: true });
  });

  it("routes check_availability through to a real tool result on valid input", async () => {
    const deps = makeDeps(
      { id: "cl1", tenant_id: "t1", caller_number: "+15551234567" },
      { "from public.availability_slots": [] },
    );
    const result = await dispatchTool(deps, "call_0123456789abcdef01234567", "check_availability", {
      date_range: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
    });
    expect(result.result).toMatchObject({ none_available: true });
  });

  it("routes lookup_customer through with the G6 caller-scope check intact", async () => {
    const deps = makeDeps({ id: "cl1", tenant_id: "t1", caller_number: "+15551234567" });
    const result = await dispatchTool(deps, "call_0123456789abcdef01234567", "lookup_customer", {
      phone: "+15559998888",
    });
    expect(result).toEqual({ result: { error: "unauthorized_lookup" } });
  });

  it("routes join_waitlist through to a real tool result", async () => {
    const deps = makeDeps({ id: "cl1", tenant_id: "t1", caller_number: "+15551234567" });
    const result = await dispatchTool(deps, "call_0123456789abcdef01234567", "join_waitlist", {
      customer: { name: "Jane Doe", phone: "not-a-phone" },
      preferred_window_start: "2026-01-01T00:00:00Z",
      preferred_window_end: "2026-01-02T00:00:00Z",
    });
    expect(result).toEqual({ result: { joined: false, reason: "invalid_phone" } });
  });

  it("CALL-2: fills deps.telemetry.tenantId with the resolved tenant, so tool_health rows are no longer always tenant_id: null", async () => {
    const deps = makeDeps({ id: "cl1", tenant_id: "t1", caller_number: "+15551234567" });
    const telemetry: { tenantId: string | null } = { tenantId: null };
    await dispatchTool({ ...deps, telemetry }, "call_0123456789abcdef01234567", "join_waitlist", {
      customer: { name: "Jane Doe", phone: "+15551234567" },
      preferred_window_start: "2026-01-01T00:00:00Z",
      preferred_window_end: "2026-01-02T00:00:00Z",
    });
    expect(telemetry.tenantId).toBe("t1");
  });

  it("CALL-2: leaves deps.telemetry.tenantId null when context never resolves (never a fabricated tenant)", async () => {
    const deps = makeDeps(null);
    const telemetry: { tenantId: string | null } = { tenantId: null };
    await dispatchTool({ ...deps, telemetry }, "call_missing", "check_availability", {
      date_range: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
    });
    expect(telemetry.tenantId).toBeNull();
  });

  it("CALL-2: resolves context from the tool payload's call.agent_id when no call_logs row exists, instead of always falling back", async () => {
    const deps = makeDeps(null, {
      "from public.agent_configs": [{ tenant_id: "t9", vertical: "auto" }],
      "insert into public.call_logs": [
        { id: "cl-new", tenant_id: "t9", caller_number: "+15550001111" },
      ],
    });
    const result = await dispatchTool(
      deps,
      "test_batch_call_1",
      "check_availability",
      { date_range: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" } },
      { agent_id: "agent_9" },
    );
    // Resolved a real tenant (t9) rather than the graceful fallback — the
    // exact CALL-1-traced bug (batch-test/chat sessions always getting the
    // fallback because no call_logs row exists for a synthetic call_id).
    expect(result.result).not.toMatchObject({ fallback: true });
  });
});

describe("resolveEnvelopeCallId", () => {
  it("prefers a top-level call_id when present", () => {
    expect(resolveEnvelopeCallId({ call_id: "top", call: { call_id: "nested" } })).toBe("top");
  });

  it("falls back to call.call_id (the real Retell shape) when there is no top-level call_id", () => {
    expect(resolveEnvelopeCallId({ call: { call_id: "nested" } })).toBe("nested");
  });

  it("returns null when neither is present", () => {
    expect(resolveEnvelopeCallId({})).toBeNull();
  });
});
