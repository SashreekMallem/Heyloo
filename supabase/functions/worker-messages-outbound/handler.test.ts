import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { OutboundDeps } from "./handler.ts";
import {
  OUTBOUND_NOT_CONFIGURED_PARK_SECONDS,
  processOutboundMessage,
  runOutboundWorker,
  sweepNotConfiguredOutbound,
} from "./handler.ts";

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

  it("throws (never swallows) on a transient Twilio failure so the queue retries and eventually dead-letters it", async () => {
    const { sql, calls } = makeSql({
      "from public.messages_outbound": [BASE_MESSAGE],
      "from public.customers": [{ sms_opt_out: false }],
      "from public.tenants": [{ a2p_status: "verified" }],
    });
    const deps = makeDeps({
      twilioFetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ message: "internal error" }), { status: 500 }),
        )) as never,
    });
    await expect(processOutboundMessage(sql, "msg_1", deps)).rejects.toThrow(
      "twilio_send_transient_failure:500",
    );
    // Never written to a terminal status on a transient failure — the row
    // stays retryable.
    expect(calls.some((c) => c.text.includes("status = 'failed'"))).toBe(false);
  });

  it("marks failed without throwing on a permanent Twilio rejection (invalid 'To' number)", async () => {
    const { sql, calls } = makeSql({
      "from public.messages_outbound": [BASE_MESSAGE],
      "from public.customers": [{ sms_opt_out: false }],
      "from public.tenants": [{ a2p_status: "verified" }],
    });
    const deps = makeDeps({
      twilioFetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ code: 21211, message: "Invalid 'To' Phone Number" }), {
            status: 400,
          }),
        )) as never,
    });
    const outcome = await processOutboundMessage(sql, "msg_1", deps);
    expect(outcome).toBe("failed");
    expect(calls.some((c) => c.text.includes("status = 'failed'"))).toBe(true);
  });

  it("throws on a transient Resend failure instead of marking the message failed", async () => {
    const { sql, calls } = makeSql({
      "from public.messages_outbound": [BASE_MESSAGE],
      "from public.customers": [{ sms_opt_out: false }],
      "from public.tenants": [{ a2p_status: "pending_verification" }],
    });
    const deps = makeDeps({
      resendFetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ name: "internal_server_error" }), { status: 500 }),
        )) as never,
    });
    await expect(processOutboundMessage(sql, "msg_1", deps)).rejects.toThrow(
      "resend_send_transient_failure:500",
    );
    expect(calls.some((c) => c.text.includes("status = 'failed'"))).toBe(false);
  });

  it("marks failed without throwing on a permanent Resend validation error", async () => {
    const { sql } = makeSql({
      "from public.messages_outbound": [BASE_MESSAGE],
      "from public.customers": [{ sms_opt_out: false }],
      "from public.tenants": [{ a2p_status: "pending_verification" }],
    });
    const deps = makeDeps({
      resendFetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ name: "validation_error" }), { status: 400 }),
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

// OPS-8 (docs/BUILD_NOTES.md): the retry/dead-letter write in
// `runOutboundWorker`'s catch block is now itself wrapped in a try/catch,
// the same defensive shape applied to worker-recording-fetch/
// worker-adapter-push after that class of bug was found live there — a
// failure writing the DLQ move must never strand the rest of the batch.
describe("runOutboundWorker", () => {
  const row = (over: { msgId: number; readCt: number; messageId: string }) => ({
    msg_id: over.msgId,
    read_ct: over.readCt,
    enqueued_at: "now",
    vt: "now",
    message: { message_id: over.messageId },
  });

  it("dead-letters with a recorded reason once max attempts is reached", async () => {
    const batch = [row({ msgId: 1, readCt: 5, messageId: "msg_1" })];
    const calls: { text: string; values: unknown[] }[] = [];
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      calls.push({ text, values });
      if (text.includes("pgmq.read")) return batch;
      if (text.includes("from public.messages_outbound")) {
        throw new Error("twilio_send_transient_failure:503");
      }
      return [];
    }) as SqlClient;

    const result = await runOutboundWorker(sql, makeDeps());

    expect(result.processed).toBe(0);
    expect(result.dead_lettered).toBe(1);
    const dlqCall = calls.find(
      (c) =>
        c.text.includes("pgmq.send") && String(c.values[0]).includes("messages_outbound_queue_dlq"),
    );
    const payload = dlqCall?.values.find(
      (v) => typeof v === "object" && v !== null && "reason" in (v as object),
    ) as { reason: string } | undefined;
    expect(payload?.reason).toContain("max_attempts_exceeded");
    expect(payload?.reason).toContain("twilio_send_transient_failure");
  });

  it("never crashes the batch even when the dead-letter write itself throws", async () => {
    const batch = [
      row({ msgId: 1, readCt: 5, messageId: "msg_1" }),
      row({ msgId: 2, readCt: 5, messageId: "msg_2" }),
    ];
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("pgmq.read")) return batch;
      if (text.includes("from public.messages_outbound")) {
        throw new Error("transient");
      }
      // Row 1's dead-letter move (archive) blows up; row 2 must still run.
      if (text.includes("pgmq.archive") && values[1] === 1) {
        throw new Error("db_blip");
      }
      return [];
    }) as SqlClient;

    const result = await runOutboundWorker(sql, makeDeps());

    // Row 2 still got dead-lettered normally despite row 1's failure.
    expect(result.dead_lettered).toBe(1);
  });
});

// OPS-8 deliverable 2: honest "provider not configured" park+DLQ behavior.
describe("sweepNotConfiguredOutbound", () => {
  it("dead-letters, with reason provider_not_configured, only messages older than the park window", async () => {
    const staleMessage = { msg_id: 1, message: { message_id: "m1" } };
    const calls: { text: string; values: unknown[] }[] = [];
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      calls.push({ text, values });
      if (text.includes("pgmq.q_messages_outbound_queue")) return [staleMessage];
      return [];
    }) as SqlClient;

    const result = await sweepNotConfiguredOutbound(sql);

    expect(result.dead_lettered).toBe(1);
    const staleQuery = calls.find((c) => c.text.includes("pgmq.q_messages_outbound_queue"));
    expect(staleQuery?.values).toContain(OUTBOUND_NOT_CONFIGURED_PARK_SECONDS);
    const dlqCall = calls.find(
      (c) =>
        c.text.includes("pgmq.send") && String(c.values[0]).includes("messages_outbound_queue_dlq"),
    );
    const payload = dlqCall?.values.find(
      (v) => typeof v === "object" && v !== null && "reason" in (v as object),
    ) as { reason: string } | undefined;
    expect(payload?.reason).toBe("provider_not_configured");
    const statusUpdate = calls.find(
      (c) => c.text.includes("update public.messages_outbound") && c.values.includes("m1"),
    );
    expect(statusUpdate).toBeDefined();
    expect(statusUpdate?.text).toContain("status = 'failed'");
    expect(statusUpdate?.text).toContain("provider_not_configured");
  });

  it("never calls pgmq.read — a peek only, so a not-configured tick never bumps read_ct", async () => {
    const calls: string[] = [];
    const sql = (async (strings: TemplateStringsArray) => {
      calls.push(strings.join(" "));
      return [];
    }) as SqlClient;

    await sweepNotConfiguredOutbound(sql);

    expect(calls.some((t) => t.includes("pgmq.read"))).toBe(false);
  });

  it("leaves nothing to dead-letter when the queue has no stale messages", async () => {
    const sql = (async () => []) as SqlClient;
    const result = await sweepNotConfiguredOutbound(sql);
    expect(result.dead_lettered).toBe(0);
  });
});
