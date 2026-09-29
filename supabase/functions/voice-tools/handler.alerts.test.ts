import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { DispatchDeps } from "./handler.ts";
import { dispatchTool } from "./handler.ts";
import { MANUAL_MODE_BOOKING_MESSAGE, MANUAL_MODE_ORDER_MESSAGE } from "./manual-mode.ts";

const logger = createLogger();
const CALL_ID = "call_0123456789abcdef01234567";

function makeDeps(opts: { manualMode: boolean; defer?: DispatchDeps["defer"] }) {
  const calls: { text: string; values: unknown[] }[] = [];
  const routes: Record<string, unknown[]> = {
    "from public.call_logs": [
      {
        id: "cl1",
        tenant_id: "t1",
        caller_number: "+15551234567",
        vertical: "generic",
        is_test_call: false,
        manual_mode: opts.manualMode,
      },
    ],
    "public.agent_configs ac": [
      { transfer_number: null, delivery: null, owner_email: "o@example.com" },
    ],
    "insert into public.messages_outbound": [{ id: "alert_1" }],
  };
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [key, rows] of Object.entries(routes)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  const deps: DispatchDeps = {
    sql,
    logger,
    paymentLink: {
      fetchImpl: () => Promise.reject(new Error("unused")),
      stripeSecretKey: "sk_test",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    },
    dentalIntake: { appBaseUrl: "https://app.example.com" },
    ...(opts.defer ? { defer: opts.defer } : {}),
  };
  return { deps, calls };
}

describe("dispatchTool - Manual Mode is enforced end to end (VOICE-ALERTS-1)", () => {
  it("create_booking in manual mode answers with the take-a-message instruction and writes nothing", async () => {
    const { deps, calls } = makeDeps({ manualMode: true });
    const result = await dispatchTool(deps, CALL_ID, "create_booking", {
      resource_id: "11111111-1111-1111-1111-111111111111",
      start: "2999-01-15T14:00:00.000Z",
      end: "2999-01-15T14:30:00.000Z",
      customer: { name: "Jordan", phone: "555-123-4567" },
    });
    expect(result).toEqual({
      result: { confirmed: false, reason: "manual_mode", message: MANUAL_MODE_BOOKING_MESSAGE },
    });
    expect(calls.some((c) => c.text.includes("create_booking:"))).toBe(false);
    expect(calls.some((c) => c.text.includes("insert into"))).toBe(false);
  });

  it("create_order in manual mode answers with the take-a-message instruction and writes nothing", async () => {
    const { deps, calls } = makeDeps({ manualMode: true });
    const result = await dispatchTool(deps, CALL_ID, "create_order", {
      items: [{ name: "Burger", qty: 1 }],
      fulfillment_type: "pickup",
      customer: { name: "Jordan", phone: "555-123-4567" },
    });
    expect(result).toEqual({
      result: { confirmed: false, reason: "manual_mode", message: MANUAL_MODE_ORDER_MESSAGE },
    });
    expect(calls.some((c) => c.text.includes("insert into"))).toBe(false);
  });

  it("take_message still works in manual mode and alerts the owner (the fallback the agent is told to use)", async () => {
    const { deps, calls } = makeDeps({ manualMode: true });
    const result = await dispatchTool(deps, CALL_ID, "take_message", {
      caller_name: "Jordan Lee",
      caller_phone: "555-123-4567",
      message_text: "Book me Thursday",
    });
    expect(result).toEqual({ result: { recorded: true } });
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(true);
  });
});

describe("dispatchTool - owner alerts stay off the response path (VOICE-ALERTS-1)", () => {
  it("take_message hands its owner alert to the hot path's defer hook", async () => {
    const deferred: { label: string; task: () => Promise<void> }[] = [];
    const { deps, calls } = makeDeps({
      manualMode: false,
      defer: (label, task) => deferred.push({ label, task }),
    });
    const result = await dispatchTool(deps, CALL_ID, "take_message", {
      caller_name: "Jordan Lee",
      caller_phone: "555-123-4567",
      message_text: "Call me back",
    });
    expect(result).toEqual({ result: { recorded: true } });
    expect(calls.some((c) => c.text.includes("messages_outbound"))).toBe(false);
    expect(deferred.map((d) => d.label)).toEqual(["take_message_owner_alert"]);
    await deferred[0]?.task();
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(true);
  });
});
