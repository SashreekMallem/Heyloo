import { describe, expect, it } from "vitest";
import { chatText, fakeLlm } from "../_shared/providers/llm/test-support.ts";
import type { CanonicalInboundSms } from "../_shared/providers/messaging/types.ts";
import type { TextAgentDeps } from "../_shared/text-agent/engine.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import { processInboundSms } from "./handler.ts";

const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function makeSql(fixtures: Record<string, unknown[]> = {}): { sql: SqlClient; calls: string[] } {
  const calls: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    calls.push(text);
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

const BASE_SMS: CanonicalInboundSms = {
  provider: "twilio",
  eventId: "SM1",
  providerMessageId: "SM1",
  fromE164: "+15551234567",
  toE164: "+15559998888",
  body: "hi",
  providerHandledKeyword: null,
};

describe("processInboundSms", () => {
  it("no-ops when the tenant cannot be resolved for the To number", async () => {
    const { sql, calls } = makeSql({});
    const result = await processInboundSms(sql, { ...BASE_SMS });
    expect(result).toEqual({});
    expect(calls.some((c) => c.includes("insert into public.messages_inbound"))).toBe(false);
  });

  it("sets sms_opt_out=true and replies with the compliance message on STOP", async () => {
    const { sql, calls } = makeSql({ "from public.phone_numbers": [{ tenant_id: "t1" }] });
    const result = await processInboundSms(sql, { ...BASE_SMS, body: "STOP" });
    expect(result.replyBody).toContain("unsubscribed");
    expect(calls.some((c) => c.includes("sms_opt_out = true"))).toBe(true);
  });

  it("clears sms_opt_out on START", async () => {
    const { sql, calls } = makeSql({ "from public.phone_numbers": [{ tenant_id: "t1" }] });
    const result = await processInboundSms(sql, { ...BASE_SMS, body: "START" });
    expect(result.replyBody).toContain("resubscribed");
    expect(calls.some((c) => c.includes("sms_opt_out = false"))).toBe(true);
  });

  it("replies with static help text on HELP, without touching opt-out state", async () => {
    const { sql, calls } = makeSql({ "from public.phone_numbers": [{ tenant_id: "t1" }] });
    const result = await processInboundSms(sql, { ...BASE_SMS, body: "HELP" });
    expect(result.replyBody).toContain("Heyloo AI assistant");
    expect(calls.some((c) => c.includes("sms_opt_out"))).toBe(false);
  });

  it("stores an ordinary inbound message with no auto-reply", async () => {
    const { sql, calls } = makeSql({ "from public.phone_numbers": [{ tenant_id: "t1" }] });
    const result = await processInboundSms(sql, { ...BASE_SMS, body: "What time do you open?" });
    expect(result).toEqual({});
    expect(calls.some((c) => c.includes("insert into public.messages_inbound"))).toBe(true);
  });

  it("still treats a bare YES with no waitlist context as the ordinary START opt-in keyword", async () => {
    const { sql, calls } = makeSql({
      "from public.phone_numbers": [{ tenant_id: "t1" }],
      "from public.customers": [{ id: "cust-1" }],
      // no "from public.messages_outbound" fixture -> [] -> no waitlist match
    });
    const result = await processInboundSms(sql, { ...BASE_SMS, body: "YES" });
    expect(result.replyBody).toContain("resubscribed");
    expect(calls.some((c) => c.includes("sms_opt_out = false"))).toBe(true);
  });

  it("auto-books the freed slot on YES when a notified waitlist entry matches", async () => {
    const { sql, calls } = makeSql({
      "from public.customers": [{ id: "cust-1" }],
      "from public.phone_numbers": [{ tenant_id: "t1" }],
      "from public.messages_outbound": [
        { payload: { waitlist_entry_id: "entry-1" }, related_booking_id: "booking-1" },
      ],
      "from public.waitlist_entries": [{ id: "entry-1", status: "notified", offering_id: "off-1" }],
      "from public.bookings where id": [
        { resource_id: "res-1", start_at: "2026-10-01T14:00:00Z", end_at: "2026-10-01T14:30:00Z" },
      ],
      "from public.availability_slots": [{ id: "slot-1" }],
    });
    const result = await processInboundSms(sql, { ...BASE_SMS, body: "yes" });
    expect(result.replyBody).toContain("booked");
    expect(calls.some((c) => c.includes("insert into public.bookings"))).toBe(true);
    expect(calls.some((c) => c.includes("status = 'converted'"))).toBe(true);
  });

  it("apologizes and expires the waitlist entry when the slot was already taken", async () => {
    const { sql, calls } = makeSql({
      "from public.customers": [{ id: "cust-1" }],
      "from public.phone_numbers": [{ tenant_id: "t1" }],
      "from public.messages_outbound": [
        { payload: { waitlist_entry_id: "entry-1" }, related_booking_id: "booking-1" },
      ],
      "from public.waitlist_entries": [{ id: "entry-1", status: "notified", offering_id: "off-1" }],
      "from public.bookings where id": [
        { resource_id: "res-1", start_at: "2026-10-01T14:00:00Z", end_at: "2026-10-01T14:30:00Z" },
      ],
      // no availability_slots fixture -> [] -> slot no longer open
    });
    const result = await processInboundSms(sql, { ...BASE_SMS, body: "Y" });
    expect(result.replyBody).toContain("already been taken");
    expect(calls.some((c) => c.includes("status = 'expired'"))).toBe(true);
    expect(calls.some((c) => c.includes("insert into public.bookings"))).toBe(false);
  });

  describe("Cluster T text-agent engine routing (post STOP/HELP/waitlist-YES)", () => {
    function engineFixtures(overrides: Record<string, unknown[]> = {}) {
      return {
        "from public.phone_numbers": [{ tenant_id: "t1", id: "pn1" }],
        "insert into public.text_conversations": [
          {
            id: "conv-1",
            tenant_id: "t1",
            channel: "sms",
            phone_e164: "+15551234567",
            customer_id: null,
            widget_session_token_hash: null,
            call_log_id: null,
            status: "open",
            structured_state: {},
            recent_turns: [],
            disclosure_sent: false,
            verification_phone_e164: null,
            verification_code_hash: null,
            verification_code_expires_at: null,
            verification_attempts: 0,
            message_count: 0,
            ai_message_count: 0,
          },
        ],
        "from public.tenants t": [
          {
            business_name: "Acme Dental",
            vertical: "dental",
            timezone: "America/New_York",
            a2p_status: "verified",
            assistant_name: null,
            transfer_number: null,
            dynamic_variable_overrides: {},
            disclosure_line: "disclosure",
            // SETTINGS-2: the owner's "Text agent enabled" switch now gates SMS replies.
            text_agent_enabled: true,
          },
        ],
        ...overrides,
      };
    }

    it("uses the engine's AI reply as the TwiML body for an ordinary message", async () => {
      const { sql, calls } = makeSql(engineFixtures());
      const llm = fakeLlm({ chat: () => chatText("Sure — what day works for you?") });
      const deps: TextAgentDeps = {
        sql,
        logger: silentLogger,
        llm,
        appBaseUrl: "https://heyloo.app",
        turnTimeoutMs: 2000,
      };

      const result = await processInboundSms(
        sql,
        { ...BASE_SMS, body: "Can I book a cleaning?" },
        deps,
      );

      expect(result.replyBody).toContain("Sure — what day works for you?");
      expect(result.replyBody).toContain("texting with Acme Dental's AI assistant");
      expect(calls.some((c) => c.includes("insert into public.messages_inbound"))).toBe(true);

      // CHANNELS-2 item 7 (delivery-tracking option (b)): the AI reply
      // synchronously handed back as TwiML must ALSO land a
      // messages_outbound row so the dashboard thread/delivery status stay
      // consistent — already 'sent' (the TwiML send already happened),
      // never 'queued' (must not be re-sent by the outbound queue worker).
      const outboundCall = calls.find((c) => c.includes("insert into public.messages_outbound"));
      expect(outboundCall).toBeTruthy();
      expect(outboundCall).toContain("'sms'");
      expect(outboundCall).toContain("'text_agent_reply'");
      expect(outboundCall).toContain("'sent'");
    });

    it("never inserts a messages_outbound row when the engine reply is suppressed", async () => {
      const { sql, calls } = makeSql(
        engineFixtures({
          "from public.tenants t": [
            {
              business_name: "Acme Dental",
              vertical: "dental",
              timezone: "America/New_York",
              a2p_status: "pending_verification",
              assistant_name: null,
              transfer_number: null,
              dynamic_variable_overrides: {},
              disclosure_line: "disclosure",
            },
          ],
        }),
      );
      const llm = fakeLlm({ chat: () => chatText("should never be reached") });
      const deps: TextAgentDeps = {
        sql,
        logger: silentLogger,
        llm,
        appBaseUrl: "https://heyloo.app",
      };

      const result = await processInboundSms(
        sql,
        { ...BASE_SMS, body: "Can I book a cleaning?" },
        deps,
      );

      expect(result.replyBody).toBeUndefined();
      expect(calls.some((c) => c.includes("insert into public.messages_outbound"))).toBe(false);
    });

    it("archives without replying (no AI call) when the tenant's A2P campaign isn't verified", async () => {
      const { sql, calls } = makeSql(
        engineFixtures({
          "from public.tenants t": [
            {
              business_name: "Acme Dental",
              vertical: "dental",
              timezone: "America/New_York",
              a2p_status: "pending_verification",
              assistant_name: null,
              transfer_number: null,
              dynamic_variable_overrides: {},
              disclosure_line: "disclosure",
            },
          ],
        }),
      );
      const llm = fakeLlm({ chat: () => chatText("should never be reached") });
      const deps: TextAgentDeps = {
        sql,
        logger: silentLogger,
        llm,
        appBaseUrl: "https://heyloo.app",
      };

      const result = await processInboundSms(
        sql,
        { ...BASE_SMS, body: "Can I book a cleaning?" },
        deps,
      );

      expect(result.replyBody).toBeUndefined();
      expect(llm.calls.chat).toHaveLength(0);
      expect(calls.some((c) => c.includes("insert into public.messages_inbound"))).toBe(true);
    });

    it("falls back to archive-only behavior when no engine deps are provided (unchanged from before this task)", async () => {
      const { sql } = makeSql(engineFixtures());
      const result = await processInboundSms(sql, { ...BASE_SMS, body: "Can I book a cleaning?" });
      expect(result).toEqual({});
    });
  });
});
