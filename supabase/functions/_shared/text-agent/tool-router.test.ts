import { describe, expect, it } from "vitest";
import type { Logger, SqlClient } from "../types.ts";
import { dispatchTextTool } from "./tool-router.ts";
import type { TextConversationRow } from "./types.ts";

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

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeConversation(overrides: Partial<TextConversationRow> = {}): TextConversationRow {
  return {
    id: "conv-1",
    tenantId: "t1",
    channel: "sms",
    phoneE164: "+15551234567",
    customerId: null,
    widgetSessionTokenHash: null,
    callLogId: "call-log-1", // pre-set so buildCallContext skips the shadow-row insert
    status: "open",
    structuredState: {},
    recentTurns: [],
    disclosureSent: false,
    verificationPhoneE164: null,
    verificationCodeHash: null,
    verificationCodeExpiresAt: null,
    verificationAttempts: 0,
    messageCount: 0,
    aiMessageCount: 0,
    ...overrides,
  };
}

describe("dispatchTextTool", () => {
  it("routes check_availability to the shared voice-tools handler", async () => {
    const { sql } = makeSql({ "from public.availability_slots": [] });
    const conversation = makeConversation();
    const { resultText, isError } = await dispatchTextTool(
      {
        sql,
        logger: silentLogger,
        conversation,
        vertical: "dental",
        appBaseUrl: "https://heyloo.app",
        a2pVerified: true,
      },
      "check_availability",
      { date_range: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" } },
    );
    expect(isError).toBe(false);
    const parsed = JSON.parse(resultText);
    expect(parsed.none_available).toBe(true);
  });

  it("returns invalid_args for a malformed tool call rather than throwing", async () => {
    const { sql } = makeSql();
    const conversation = makeConversation();
    const { resultText, isError } = await dispatchTextTool(
      {
        sql,
        logger: silentLogger,
        conversation,
        vertical: "dental",
        appBaseUrl: "x",
        a2pVerified: true,
      },
      "check_availability",
      { not_a_valid_field: true },
    );
    expect(isError).toBe(true);
    expect(JSON.parse(resultText)).toEqual({ error: "invalid_args" });
  });

  it("returns unknown_tool for an unrecognized tool name", async () => {
    const { sql } = makeSql();
    const conversation = makeConversation();
    const { resultText, isError } = await dispatchTextTool(
      {
        sql,
        logger: silentLogger,
        conversation,
        vertical: "dental",
        appBaseUrl: "x",
        a2pVerified: true,
      },
      "delete_everything",
      {},
    );
    expect(isError).toBe(true);
    expect(JSON.parse(resultText)).toEqual({ error: "unknown_tool" });
  });

  describe("verify_phone", () => {
    it("is not applicable on the SMS channel", async () => {
      const { sql } = makeSql();
      const conversation = makeConversation({ channel: "sms" });
      const { resultText, isError } = await dispatchTextTool(
        {
          sql,
          logger: silentLogger,
          conversation,
          vertical: "dental",
          appBaseUrl: "x",
          a2pVerified: true,
        },
        "verify_phone",
        { phone: "+15551234567" },
      );
      expect(isError).toBe(true);
      expect(JSON.parse(resultText).error).toBe("not_applicable_for_this_channel");
    });

    it("declines to send when the tenant's A2P campaign isn't verified", async () => {
      const { sql, calls } = makeSql();
      const conversation = makeConversation({ channel: "web_chat", phoneE164: null });
      const { resultText, isError } = await dispatchTextTool(
        {
          sql,
          logger: silentLogger,
          conversation,
          vertical: "dental",
          appBaseUrl: "x",
          a2pVerified: false,
        },
        "verify_phone",
        { phone: "+15551234567" },
      );
      expect(isError).toBe(false);
      expect(JSON.parse(resultText).sent).toBe(false);
      expect(calls.some((c) => c.includes("insert into public.messages_outbound"))).toBe(false);
    });

    it("sends a code and persists pending verification when A2P is verified", async () => {
      const { sql, calls } = makeSql({ "insert into public.messages_outbound": [{ id: "msg-1" }] });
      const conversation = makeConversation({ channel: "web_chat", phoneE164: null });
      const { resultText, isError } = await dispatchTextTool(
        {
          sql,
          logger: silentLogger,
          conversation,
          vertical: "dental",
          appBaseUrl: "x",
          a2pVerified: true,
        },
        "verify_phone",
        { phone: "5551234567" },
      );
      expect(isError).toBe(false);
      expect(JSON.parse(resultText).sent).toBe(true);
      expect(conversation.verificationPhoneE164).toBe("+15551234567");
      expect(conversation.verificationCodeHash).toBeTruthy();
      expect(calls.some((c) => c.includes("insert into public.messages_outbound"))).toBe(true);
      expect(calls.some((c) => c.includes("'chat_phone_verification'"))).toBe(true);
    });

    it("rejects an invalid phone without writing anything", async () => {
      const { sql, calls } = makeSql();
      const conversation = makeConversation({ channel: "web_chat", phoneE164: null });
      const { resultText, isError } = await dispatchTextTool(
        {
          sql,
          logger: silentLogger,
          conversation,
          vertical: "dental",
          appBaseUrl: "x",
          a2pVerified: true,
        },
        "verify_phone",
        { phone: "abc" },
      );
      expect(isError).toBe(false);
      expect(JSON.parse(resultText)).toEqual({ sent: false, reason: "invalid_phone" });
      expect(calls).toHaveLength(0);
    });

    it("blocks a distinct 4th phone number in one conversation, but keeps allowing resends to a number already tried once its cooldown has elapsed (SMS-bombing regression)", async () => {
      const { sql, calls } = makeSql({ "insert into public.messages_outbound": [{ id: "msg-1" }] });
      const conversation = makeConversation({
        channel: "web_chat",
        phoneE164: null,
        tenantId: "distinct-phone-cap-tenant",
      });
      let clock = new Date("2026-01-01T00:00:00Z");
      const deps = {
        sql,
        logger: silentLogger,
        conversation,
        vertical: "dental",
        appBaseUrl: "x",
        a2pVerified: true,
        now: () => clock,
      };

      const distinctNumbers = ["+15550000001", "+15550000002", "+15550000003"];
      for (const phone of distinctNumbers) {
        const { resultText, isError } = await dispatchTextTool(deps, "verify_phone", { phone });
        expect(isError).toBe(false);
        expect(JSON.parse(resultText).sent).toBe(true);
      }

      const sendsBeforeBlock = calls.filter((c) =>
        c.includes("insert into public.messages_outbound"),
      ).length;

      const blocked = await dispatchTextTool(deps, "verify_phone", { phone: "+15550000004" });
      expect(blocked.isError).toBe(false);
      expect(JSON.parse(blocked.resultText)).toMatchObject({
        sent: false,
        reason: "too_many_numbers",
      });
      // the block happened before any send for the 4th number
      expect(calls.filter((c) => c.includes("insert into public.messages_outbound")).length).toBe(
        sendsBeforeBlock,
      );

      // resending to an already-attempted number is unaffected by the
      // distinct-number cap, but IS still subject to the per-number cooldown
      // below — advance the clock past it first.
      clock = new Date(clock.getTime() + 61_000);
      const resend = await dispatchTextTool(deps, "verify_phone", { phone: distinctNumbers[0] });
      expect(JSON.parse(resend.resultText).sent).toBe(true);
    });

    it("cools down repeat sends to the same number regardless of which conversation triggers them (SMS-bombing-a-single-victim regression)", async () => {
      const { sql, calls } = makeSql({ "insert into public.messages_outbound": [{ id: "msg-1" }] });
      const tenantId = "verify-phone-cooldown-tenant";
      const victimPhone = "+15559998888";
      const clock = new Date("2026-02-01T00:00:00Z");
      const baseDeps = {
        sql,
        logger: silentLogger,
        vertical: "dental",
        appBaseUrl: "x",
        a2pVerified: true,
        now: () => clock,
      };

      // First send, from one conversation, succeeds.
      const first = await dispatchTextTool(
        {
          ...baseDeps,
          conversation: makeConversation({
            id: "conv-a",
            channel: "web_chat",
            phoneE164: null,
            tenantId,
          }),
        },
        "verify_phone",
        { phone: victimPhone },
      );
      expect(JSON.parse(first.resultText).sent).toBe(true);
      const sendsAfterFirst = calls.filter((c) =>
        c.includes("insert into public.messages_outbound"),
      ).length;

      // A SECOND, freshly-minted conversation immediately targeting the SAME
      // number is blocked by the cooldown, not just the (per-conversation)
      // distinct-number cap, which a fresh conversation would otherwise reset.
      const second = await dispatchTextTool(
        {
          ...baseDeps,
          conversation: makeConversation({
            id: "conv-b",
            channel: "web_chat",
            phoneE164: null,
            tenantId,
          }),
        },
        "verify_phone",
        { phone: victimPhone },
      );
      expect(JSON.parse(second.resultText)).toMatchObject({ sent: false, reason: "cooldown" });
      expect(calls.filter((c) => c.includes("insert into public.messages_outbound")).length).toBe(
        sendsAfterFirst,
      );

      // Once the cooldown window elapses, the same number can be sent to
      // again.
      const later = new Date(clock.getTime() + 61_000);
      const third = await dispatchTextTool(
        {
          ...baseDeps,
          now: () => later,
          conversation: makeConversation({
            id: "conv-c",
            channel: "web_chat",
            phoneE164: null,
            tenantId,
          }),
        },
        "verify_phone",
        { phone: victimPhone },
      );
      expect(JSON.parse(third.resultText).sent).toBe(true);
    });

    it("caps verify_phone at a tenant-wide hourly budget, independent of the per-conversation cap (open SMS-relay regression)", async () => {
      const { sql } = makeSql({ "insert into public.messages_outbound": [{ id: "msg-1" }] });
      const tenantId = "verify-phone-hourly-cap-tenant";

      let allowed = 0;
      let blockedForRateLimit = 0;
      // Simulates an attacker minting a FRESH conversation (and a fresh
      // target phone number) every time, which the per-conversation
      // distinct-number cap alone cannot stop — only the tenant-wide
      // limiter below can.
      for (let i = 0; i < 25; i++) {
        const conversation = makeConversation({
          id: `conv-${i}`,
          channel: "web_chat",
          phoneE164: null,
          tenantId,
        });
        const { resultText } = await dispatchTextTool(
          {
            sql,
            logger: silentLogger,
            conversation,
            vertical: "dental",
            appBaseUrl: "x",
            a2pVerified: true,
          },
          "verify_phone",
          { phone: `+1555000${String(i).padStart(4, "0")}` },
        );
        const parsed = JSON.parse(resultText);
        if (parsed.sent) {
          allowed += 1;
        } else if (parsed.reason === "rate_limited") {
          blockedForRateLimit += 1;
        }
      }

      expect(allowed).toBe(20);
      expect(blockedForRateLimit).toBe(5);
    });
  });

  it("returns unavailable for send_payment_link when Stripe deps aren't wired", async () => {
    const { sql } = makeSql();
    const conversation = makeConversation();
    const { resultText, isError } = await dispatchTextTool(
      {
        sql,
        logger: silentLogger,
        conversation,
        vertical: "dental",
        appBaseUrl: "x",
        a2pVerified: true,
      },
      "send_payment_link",
      { phone: "+15551234567", purpose: "deposit", amount_cents: 5000 },
    );
    expect(isError).toBe(true);
    expect(JSON.parse(resultText)).toEqual({ queued: false, reason: "unavailable" });
  });
});
