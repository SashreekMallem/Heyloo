import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import { createMessagingRegistry } from "../_shared/providers/messaging/registry.ts";
import { createSmtpEmailProvider } from "../_shared/providers/messaging/smtp.ts";
import {
  FakeSmtpServer,
  inMemoryConnector,
} from "../_shared/providers/messaging/smtp-fake-server.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { OutboundDeps } from "./handler.ts";
import { ParkMessageError, processOutboundMessage } from "./handler.ts";

/**
 * MSG-3: the launch state. Owner decision: phone numbers are Retell-provided
 * and there is NO texting provider, so no tenant has a verified SMS sender and
 * no SMS provider has secrets. Owner alerts must still reach the owner, by
 * email, through the owner's own mailbox over SMTP, whatever their delivery
 * preferences say about texting, and must never be silently dropped or
 * reported as sent when nothing was delivered.
 */

const logger = createLogger();
const CREDENTIALS = { username: "alerts@example.com", password: "app-password" };

const MESSAGE = "from public.messages_outbound where id";
const ROUTE = "public.messaging_senders ms";
const CONTACT = "public.agent_configs ac";

const BASE = {
  id: "0b5f4c1e-8a0f-4d7e-9f0e-3f6f2a1b9c11",
  tenant_id: "t1",
  channel: "sms", // what `enqueueOwnerAlert` writes when the owner's alert phone is known
  recipient: "+15550001111",
  template_key: "take_message",
  payload: { caller_name: "Jordan", caller_phone: "+15551234567", message_text: "Call me back" },
  status: "queued",
  parent_message_id: null,
  related_call_id: null,
  related_booking_id: null,
  related_order_id: null,
  created_at: "2026-09-29T12:00:00.000Z",
};

/** A Retell number, a2p pending, no messaging sender: what every live tenant looks like today. */
const NO_SENDER = {
  a2p_status: "pending_verification",
  sms_provider: null,
  sender_e164: null,
  sender_provider: null,
  sender_status: null,
  primary_e164: "+15559998888",
};
const OWNER = { transfer_number: "+15550001111", delivery: null, owner_email: "owner@example.com" };

function makeSql(fixtures: Record<string, unknown[]>) {
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

/** The registry the deployed worker builds with EMAIL_PROVIDER=smtp and no SMS keys. */
function smtpDeps(server: FakeSmtpServer, smsConfigured = false): OutboundDeps {
  const smtp = createSmtpEmailProvider({
    config: { host: "smtp.gmail.com", port: 465, ...CREDENTIALS },
    connect: inMemoryConnector(server),
    timeouts: { connectMs: 200, commandMs: 200, totalMs: 1000 },
    now: () => new Date("2026-09-29T12:00:00.000Z"),
  });
  return {
    registry: createMessagingRegistry({
      smsDefault: "telnyx",
      emailDefault: "smtp",
      sms: smsConfigured
        ? { telnyx: { configured: true, provider: { id: "telnyx" } as never } }
        : { telnyx: { configured: false, missing: ["TELNYX_API_KEY"] } },
      email: { smtp: { configured: true, provider: smtp } },
      emailFromAddress: "Heyloo <alerts@example.com>",
    }),
    logger,
  };
}

const server = () => new FakeSmtpServer({ credentials: CREDENTIALS });

describe("owner alerts with no SMS sender go by email over SMTP", () => {
  it("delivers the alert through the owner's mailbox and records email as the channel it really used", async () => {
    const fake = server();
    const { sql, calls } = makeSql({
      [MESSAGE]: [BASE],
      [CONTACT]: [OWNER],
      [ROUTE]: [NO_SENDER],
    });
    expect(await processOutboundMessage(sql, BASE.id, smtpDeps(fake))).toBe("rerouted_email");

    expect(fake.commands).toContain("MAIL FROM:<alerts@example.com>");
    expect(fake.commands).toContain("RCPT TO:<owner@example.com>");
    const data = fake.data ?? "";
    expect(data).toContain("From: Heyloo <alerts@example.com>\r\n");
    expect(data).toContain("To: <owner@example.com>\r\n");
    expect(data).toContain("Subject: New message from Jordan\r\n");
    expect(data).toContain(`Message-ID: <${BASE.id}@example.com>\r\n`);
    expect(data).toContain("Call me back");

    const update = calls.find((c) => c.text.includes("set status = 'sent'"));
    expect(update?.text).toContain("sent_via = 'email'");
    expect(update?.values).toEqual(expect.arrayContaining(["smtp", `<${BASE.id}@example.com>`]));
  });

  it("does the same when the tenant HAS a verified sender but no SMS provider has secrets", async () => {
    const fake = server();
    const verifiedNoProvider = {
      ...NO_SENDER,
      a2p_status: "verified",
      sender_e164: "+18885550100",
      sender_provider: "telnyx",
      sender_status: "verified",
    };
    const { sql } = makeSql({
      [MESSAGE]: [BASE],
      [CONTACT]: [OWNER],
      [ROUTE]: [verifiedNoProvider],
    });
    expect(await processOutboundMessage(sql, BASE.id, smtpDeps(fake, false))).toBe(
      "rerouted_email",
    );
    expect(fake.data).toContain("Subject: New message from Jordan");
  });

  it("emails even when the owner's preferences say texts on and email off (texting cannot carry it yet)", async () => {
    const fake = server();
    const prefs = { ...OWNER, delivery: { sms_enabled: true, email_enabled: false } };
    const { sql } = makeSql({ [MESSAGE]: [BASE], [CONTACT]: [prefs], [ROUTE]: [NO_SENDER] });
    expect(await processOutboundMessage(sql, BASE.id, smtpDeps(fake))).toBe("rerouted_email");
    expect(fake.commands).toContain("RCPT TO:<owner@example.com>");
  });

  it("uses the owner's notification email, and needs no alert phone at all", async () => {
    const fake = server();
    const prefs = {
      transfer_number: null,
      delivery: { notification_email: "desk@example.com" },
      owner_email: "owner@example.com",
    };
    const emailRow = { ...BASE, channel: "email", recipient: "desk@example.com" };
    const { sql } = makeSql({ [MESSAGE]: [emailRow], [CONTACT]: [prefs], [ROUTE]: [NO_SENDER] });
    expect(await processOutboundMessage(sql, BASE.id, smtpDeps(fake))).toBe("sent");
    expect(fake.commands).toContain("RCPT TO:<desk@example.com>");
  });

  it("delivers every kind of owner alert by email", async () => {
    const alerts: Array<[string, Record<string, unknown>, string]> = [
      ["owner_new_booking", { caller_name: "Ana", service: "Cleaning" }, "New booking: Ana"],
      ["owner_new_order", { caller_name: "Ana", total_cents: 2500 }, "New order from Ana"],
      ["owner_urgent_call", { caller_name: "Ana", summary: "flooding" }, "Urgent call from Ana"],
      ["owner_missed_transfer", { caller_name: "Ana" }, "Missed transfer from Ana"],
      ["after_hours_message", { caller_name: "Ana", message_text: "Hi" }, "New message from Ana"],
    ];
    for (const [template_key, payload, subject] of alerts) {
      const fake = server();
      const { sql } = makeSql({
        [MESSAGE]: [{ ...BASE, template_key, payload }],
        [CONTACT]: [OWNER],
        [ROUTE]: [NO_SENDER],
      });
      expect(await processOutboundMessage(sql, BASE.id, smtpDeps(fake)), template_key).toBe(
        "rerouted_email",
      );
      expect(fake.data, template_key).toContain(`Subject: ${subject}\r\n`);
    }
  });

  it("no owner address and no texting: the alert is marked failed with the reason, never reported sent", async () => {
    const fake = server();
    const noEmail = { transfer_number: "+15550001111", delivery: null, owner_email: null };
    const { sql, calls } = makeSql({
      [MESSAGE]: [BASE],
      [CONTACT]: [noEmail],
      [ROUTE]: [NO_SENDER],
    });
    expect(await processOutboundMessage(sql, BASE.id, smtpDeps(fake))).toBe("failed");
    expect(fake.commands).toEqual([]);
    const failed = calls.find((c) => c.text.includes("set status = 'failed'"));
    expect(failed?.values.join(" ")).toContain("owner_alert_undeliverable:sender_not_verified");
  });

  it("wrong mailbox credentials: fails the alert with a clear reason instead of retrying forever", async () => {
    const fake = new FakeSmtpServer({
      credentials: { username: "alerts@example.com", password: "other" },
    });
    const { sql, calls } = makeSql({ [MESSAGE]: [BASE], [CONTACT]: [OWNER], [ROUTE]: [NO_SENDER] });
    expect(await processOutboundMessage(sql, BASE.id, smtpDeps(fake))).toBe("failed");
    const failed = calls.find((c) => c.text.includes("set status = 'failed'"));
    expect(failed?.values.join(" ")).toContain("smtp:smtp_auth_failed");
  });

  it("a mailbox that is temporarily unavailable throws so the queue retries (never swallowed)", async () => {
    const fake = new FakeSmtpServer({
      credentials: CREDENTIALS,
      replies: { rcpt: "451 4.3.0 Try again later" },
    });
    const { sql } = makeSql({ [MESSAGE]: [BASE], [CONTACT]: [OWNER], [ROUTE]: [NO_SENDER] });
    await expect(processOutboundMessage(sql, BASE.id, smtpDeps(fake))).rejects.toThrow(
      "smtp_send_transient_failure:451",
    );
  });

  it("the mailbox's daily limit parks the alert instead of spending retries", async () => {
    const fake = new FakeSmtpServer({
      credentials: CREDENTIALS,
      replies: { dataEnd: "550 5.4.5 Daily user sending limit exceeded" },
    });
    const { sql } = makeSql({ [MESSAGE]: [BASE], [CONTACT]: [OWNER], [ROUTE]: [NO_SENDER] });
    const error = await processOutboundMessage(sql, BASE.id, smtpDeps(fake)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ParkMessageError);
    expect((error as ParkMessageError).retryAfterSeconds).toBe(3600);
  });

  it("SMTP not configured: the alert waits (parked, honest state), it is never marked sent", async () => {
    const { sql, calls } = makeSql({ [MESSAGE]: [BASE], [CONTACT]: [OWNER], [ROUTE]: [NO_SENDER] });
    const deps: OutboundDeps = {
      registry: createMessagingRegistry({
        smsDefault: "telnyx",
        emailDefault: "smtp",
        sms: {},
        email: { smtp: { configured: false, missing: ["SMTP_HOST", "SMTP_PASSWORD"] } },
        emailFromAddress: "alerts@example.com",
      }),
      logger,
    };
    const error = await processOutboundMessage(sql, BASE.id, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ParkMessageError);
    expect((error as ParkMessageError).reason).toBe("provider_not_configured");
    expect(calls.some((c) => c.text.includes("set status = 'sent'"))).toBe(false);
  });
});
