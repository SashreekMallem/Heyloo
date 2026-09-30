import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { DispatchDeps } from "./handler.ts";
import { dispatchTool } from "./handler.ts";

/**
 * F4 / F5 / F-LEGAL-XFER-1 / F-LEGAL-CANCEL-1 (BEHAVIOR-voice-agent): a
 * message is never lost and never silently reported as taken.
 */

const logger = createLogger();

function makeDeps(
  vertical: string,
  opts: { failCallLogUpdates?: number; callerNumber?: string | null } = {},
): { deps: DispatchDeps; updates: unknown[][] } {
  let remainingFailures = opts.failCallLogUpdates ?? 0;
  const updates: unknown[][] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    if (text.includes("from public.call_logs") && text.includes("retell_call_id")) {
      return Promise.resolve([
        {
          id: "cl1",
          tenant_id: "t1",
          caller_number: opts.callerNumber === undefined ? "+15551234567" : opts.callerNumber,
          vertical,
        },
      ]);
    }
    if (text.includes("update public.call_logs")) {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        return Promise.reject(new Error("remaining connection slots are reserved"));
      }
      updates.push(values);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return {
    deps: {
      sql,
      logger,
      paymentLink: {
        fetchImpl: () => Promise.reject(new Error("unused")),
        stripeSecretKey: "sk_test",
        successUrl: "https://example.com/s",
        cancelUrl: "https://example.com/c",
      },
      dentalIntake: { appBaseUrl: "https://app.example.com" },
    },
    updates,
  };
}

let callSeq = 0;
/** A fresh real-shaped call id per test: the per-call bounce counter is keyed on it. */
function nextCallId(): string {
  callSeq += 1;
  return `call_${callSeq.toString(16).padStart(24, "0")}`;
}

describe("F4: blank fields and failures never read like success", () => {
  it("treats empty caller_name/caller_phone as absent and defaults the phone from the caller id", async () => {
    const { deps } = makeDeps("auto");
    const result = await dispatchTool(deps, nextCallId(), "take_message", {
      caller_name: "",
      caller_phone: "",
      message_text: "Please call me back about my brakes.",
    });
    // The name is still required for a non-partial message, so it is asked for,
    // but the phone is no longer the reason and nothing is answered as a fallback.
    expect(result.result).toMatchObject({ error: "missing_required_fields" });
    const body = result.result as { missing_fields: string[]; message: string };
    expect(body.missing_fields).toEqual(["caller_name"]);
    expect(body.message).toContain("partial");
  });

  it("answers a missing message_text with missing_required_fields, not the generic fallback", async () => {
    const { deps } = makeDeps("auto");
    const result = await dispatchTool(deps, nextCallId(), "take_message", {
      caller_name: "Pat",
      caller_phone: "+15552010177",
      message_text: "",
    });
    expect(result.result).toMatchObject({
      error: "missing_required_fields",
      missing_fields: ["message_text"],
    });
    expect(result.result).not.toHaveProperty("fallback");
  });

  it("retries a database error once and records the message", async () => {
    const { deps, updates } = makeDeps("auto", { failCallLogUpdates: 1 });
    const result = await dispatchTool(deps, nextCallId(), "take_message", {
      caller_name: "Pat Okafor",
      caller_phone: "+15552010177",
      message_text: "Call me back.",
    });
    expect(result).toEqual({ result: { recorded: true } });
    expect(updates).toHaveLength(1);
  });

  it("tells the agent the message was NOT saved when the database keeps failing", async () => {
    const { deps } = makeDeps("auto", { failCallLogUpdates: 5 });
    const result = await dispatchTool(deps, nextCallId(), "take_message", {
      caller_name: "Pat Okafor",
      caller_phone: "+15552010177",
      message_text: "Call me back.",
    });
    expect(result.result).toMatchObject({ recorded: false, reason: "not_saved" });
    expect(JSON.stringify(result)).toContain("NOT saved");
    expect(result.result).not.toHaveProperty("fallback");
  });

  it("answers an invalid create_booking with an explicit NOT saved, not the generic fallback", async () => {
    const { deps } = makeDeps("auto");
    const result = await dispatchTool(deps, nextCallId(), "create_booking", {
      customer: { name: "Pat" },
    });
    expect(result.result).toMatchObject({ confirmed: false, reason: "not_saved" });
    expect(result.result).not.toHaveProperty("fallback");
  });

  it("answers an unresolved call context on a write tool with recorded:false", async () => {
    const { deps } = makeDeps("auto");
    const sql = (() => Promise.resolve([])) as unknown as SqlClient;
    const result = await dispatchTool({ ...deps, sql }, nextCallId(), "take_message", {
      message_text: "hi",
    });
    expect(result.result).toMatchObject({ recorded: false, reason: "not_saved" });
  });
});

describe("F5 / F-LEGAL-XFER-1 / F-LEGAL-CANCEL-1: a message is bounced once, then stored partial", () => {
  const intake = { caller_name: "Taylor Brooks", message_text: "Wants an attorney now." };

  it("bounces once with the partial escape, then stores the second attempt as a partial intake", async () => {
    const { deps, updates } = makeDeps("legal");
    const callId = nextCallId();
    const first = await dispatchTool(deps, callId, "take_message", intake);
    expect(first.result).toMatchObject({ error: "missing_required_fields" });
    expect(JSON.stringify(first)).toContain("intake_status");
    expect(updates).toHaveLength(0);

    const second = await dispatchTool(deps, callId, "take_message", intake);
    expect(second).toEqual({ result: { recorded: true, partial: true } });
    expect(updates).toHaveLength(1);
    const stored = JSON.stringify(updates[0]);
    expect(stored).toContain('"intake_status":"partial"');
    expect(stored).toContain("structured_payload.matter_type");
  });

  it("stores an explicitly partial legal intake immediately (transfer, cancellation)", async () => {
    const { deps, updates } = makeDeps("legal");
    const result = await dispatchTool(deps, nextCallId(), "take_message", {
      message_text: "Caller wants to cancel tomorrow's 10 AM consultation.",
      structured_payload: { intake_status: "partial", request_type: "cancellation" },
    });
    expect(result).toEqual({ result: { recorded: true, partial: true } });
    expect(updates).toHaveLength(1);
    expect(JSON.stringify(updates[0])).toContain("request_type");
  });

  it("stores a real-estate seller lead without an area once marked partial", async () => {
    const { deps } = makeDeps("real_estate");
    const result = await dispatchTool(deps, nextCallId(), "take_message", {
      caller_name: "Sam Seller",
      message_text: "Wants a valuation callback.",
      structured_payload: { intake_status: "partial", buyer_or_seller: "seller" },
    });
    expect(result).toEqual({ result: { recorded: true, partial: true } });
  });

  it("still records a complete legal intake normally (no partial marker)", async () => {
    const { deps } = makeDeps("legal");
    const result = await dispatchTool(deps, nextCallId(), "take_message", {
      ...intake,
      structured_payload: {
        matter_type: "family law",
        opposing_party: "Jordan Brooks",
        urgency: "standard",
      },
    });
    expect(result).toEqual({ result: { recorded: true } });
  });
});
