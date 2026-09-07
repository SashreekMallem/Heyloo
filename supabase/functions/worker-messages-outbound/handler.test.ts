import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.js";
import type { SqlClient } from "../_shared/types.js";
import type { OutboundDeps } from "./handler.js";
import { processOutboundMessage } from "./handler.js";

const logger = createLogger();

function makeSql(fixtures: Record<string, unknown[]>): {
  sql: SqlClient;
  calls: { text: string; values: unknown[] }[];
} {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

const BASE_MESSAGE = {
  id: "msg_1",
  tenant_id: "t1",
  channel: "sms",
  recipient: "+15551234567",
  template_key: "booking_confirmation",
  payload: {},
  status: "queued",
  related_booking_id: null,
  related_order_id: null,
};

function makeDeps(overrides: Partial<OutboundDeps> = {}): OutboundDeps {
  return {
    twilioFetch: (() => Promise.resolve(new Response("{}"))) as never,
    twilioAccountSid: "AC1",
    twilioAuthToken: "token",
    twilioFromNumber: async () => "+15559998888",
    resendFetch: (() => Promise.resolve(new Response("{}"))) as never,
    resendApiKey: "resend_key",
    resendFromAddress: "noreply@example.com",
    fallbackTenantEmail: async () => "owner@example.com",
    logger,
    ...overrides,
  };
}

describe("processOutboundMessage", () => {
  it("skips a message already in a terminal (sent) state", async () => {
    const { sql } = makeSql({
      "from public.messages_outbound": [{ ...BASE_MESSAGE, status: "sent" }],
    });
    const outcome = await processOutboundMessage(sql, "msg_1", makeDeps());
    expect(outcome).toBe("skipped_terminal");
  });

  it("skips and marks failed when the customer has opted out of SMS", async () => {
    const { sql, calls } = makeSql({
      "from public.messages_outbound": [BASE_MESSAGE],
      "from public.customers": [{ sms_opt_out: true }],
    });
    const outcome = await processOutboundMessage(sql, "msg_1", makeDeps());
    expect(outcome).toBe("skipped_opt_out");
    const update = calls.find(
      (c) => c.text.includes("update public.messages_outbound") && c.text.includes("sms_opt_out"),
    );
    expect(update).toBeDefined();
  });

  it("reroutes to email when the tenant's A2P status isn't verified yet", async () => {
    const { sql } = makeSql({
      "from public.messages_outbound": [BASE_MESSAGE],
      "from public.customers": [{ sms_opt_out: false }],
      "from public.tenants": [{ a2p_status: "pending_verification" }],
    });
    let emailSent = false;
    const deps = makeDeps({
      resendFetch: (() => {
        emailSent = true;
        return Promise.resolve(new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
      }) as never,
    });
    const outcome = await processOutboundMessage(sql, "msg_1", deps);
    expect(emailSent).toBe(true);
    expect(outcome).toBe("rerouted_email");
  });

  it("sends via Twilio and marks the message sent on success", async () => {
    const { sql, calls } = makeSql({
      "from public.messages_outbound": [BASE_MESSAGE],
      "from public.customers": [{ sms_opt_out: false }],
      "from public.tenants": [{ a2p_status: "verified" }],
    });
    const deps = makeDeps({
      twilioFetch: (() =>
        Promise.resolve(new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }))) as never,
    });
    const outcome = await processOutboundMessage(sql, "msg_1", deps);
    expect(outcome).toBe("sent");
    const update = calls.find((c) => c.text.includes("status = 'sent'"));
    expect(update?.values).toContain("SM123");
  });

  it("marks failed when Twilio returns a non-ok response", async () => {
    const { sql } = makeSql({
      "from public.messages_outbound": [BASE_MESSAGE],
      "from public.customers": [{ sms_opt_out: false }],
      "from public.tenants": [{ a2p_status: "verified" }],
    });
    const deps = makeDeps({
      twilioFetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ message: "bad" }), { status: 400 }),
        )) as never,
    });
    const outcome = await processOutboundMessage(sql, "msg_1", deps);
    expect(outcome).toBe("failed");
  });

  it("marks failed (never silently drops) for a not-yet-implemented channel like push", async () => {
    const { sql } = makeSql({
      "from public.messages_outbound": [{ ...BASE_MESSAGE, channel: "push" }],
    });
    const outcome = await processOutboundMessage(sql, "msg_1", makeDeps());
    expect(outcome).toBe("failed");
  });
});
