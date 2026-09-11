import { describe, expect, it } from "vitest";
import type { SqlClient } from "../types.ts";
import {
  createWebChatConversation,
  incrementTextMessagesOut,
  isSmsOptedOut,
  loadOrCreateSmsConversation,
  loadWebChatConversationByToken,
  MAX_REPLAYED_TURNS,
  resolveTenantTextContext,
  saveConversationPatch,
} from "./conversation-store.ts";
import type { TextConversationRow } from "./types.ts";

interface Call {
  text: string;
  values: unknown[];
}

function makeSql(fixtures: Record<string, unknown[]> = {}): { sql: SqlClient; calls: Call[] } {
  const calls: Call[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ? ");
    calls.push({ text, values });
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

function baseRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    ...overrides,
  };
}

describe("loadOrCreateSmsConversation", () => {
  it("returns an existing open row without inserting", async () => {
    const { sql, calls } = makeSql({ "select id, tenant_id, channel": [baseRow()] });
    const row = await loadOrCreateSmsConversation(sql, "t1", "+15551234567");
    expect(row.id).toBe("conv-1");
    expect(calls.some((c) => c.text.includes("insert into public.text_conversations"))).toBe(false);
  });

  it("reopens a closed conversation", async () => {
    const { sql, calls } = makeSql({
      "select id, tenant_id, channel": [baseRow({ status: "closed" })],
    });
    const row = await loadOrCreateSmsConversation(sql, "t1", "+15551234567");
    expect(row.status).toBe("open");
    expect(calls.some((c) => c.text.includes("set status = 'open'"))).toBe(true);
  });

  it("inserts a new row when none exists", async () => {
    const { sql, calls } = makeSql({ "insert into public.text_conversations": [baseRow()] });
    const row = await loadOrCreateSmsConversation(sql, "t1", "+15551234567");
    expect(row.id).toBe("conv-1");
    expect(calls.some((c) => c.text.includes("insert into public.text_conversations"))).toBe(true);
  });
});

describe("createWebChatConversation / loadWebChatConversationByToken", () => {
  it("mints an opaque token and returns the new conversation", async () => {
    const { sql } = makeSql({
      "insert into public.text_conversations": [baseRow({ channel: "web_chat", phone_e164: null })],
    });
    const { conversation, sessionToken } = await createWebChatConversation(sql, "t1");
    expect(conversation.channel).toBe("web_chat");
    expect(sessionToken.length).toBeGreaterThan(10);
  });

  it("returns null for an unrecognized token", async () => {
    const { sql } = makeSql({});
    const row = await loadWebChatConversationByToken(sql, "t1", "bogus-token");
    expect(row).toBeNull();
  });
});

describe("saveConversationPatch", () => {
  it("trims recent_turns to MAX_REPLAYED_TURNS", async () => {
    const { sql, calls } = makeSql();
    const conversation: TextConversationRow = {
      id: "conv-1",
      tenantId: "t1",
      channel: "sms",
      phoneE164: "+15551234567",
      customerId: null,
      widgetSessionTokenHash: null,
      callLogId: null,
      status: "open",
      structuredState: {},
      recentTurns: Array.from({ length: MAX_REPLAYED_TURNS }, (_, i) => ({
        role: "user" as const,
        text: `turn ${i}`,
        at: new Date(0).toISOString(),
      })),
      disclosureSent: false,
      verificationPhoneE164: null,
      verificationCodeHash: null,
      verificationCodeExpiresAt: null,
      verificationAttempts: 0,
      messageCount: 0,
      aiMessageCount: 0,
    };

    await saveConversationPatch(sql, conversation, {
      appendTurns: [{ role: "assistant", text: "new reply", at: new Date(1).toISOString() }],
    });

    expect(conversation.recentTurns).toHaveLength(MAX_REPLAYED_TURNS);
    expect(conversation.recentTurns.at(-1)?.text).toBe("new reply");
    expect(conversation.recentTurns[0]?.text).toBe("turn 1"); // oldest ("turn 0") dropped
    expect(calls.some((c) => c.text.includes("update public.text_conversations set"))).toBe(true);
  });

  it("mutates the in-memory row for counters/flags", async () => {
    const { sql } = makeSql();
    const conversation: TextConversationRow = {
      id: "conv-1",
      tenantId: "t1",
      channel: "sms",
      phoneE164: "+15551234567",
      customerId: null,
      widgetSessionTokenHash: null,
      callLogId: null,
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
    };

    await saveConversationPatch(sql, conversation, {
      incrementMessageCount: true,
      incrementAiMessageCount: true,
      disclosureSent: true,
    });

    expect(conversation.messageCount).toBe(1);
    expect(conversation.aiMessageCount).toBe(1);
    expect(conversation.disclosureSent).toBe(true);
  });

  it("records every appended turn onto the full text_conversation_messages transcript, author derived from role (docs/audit/CHANNELS_REQUESTS.md item 5)", async () => {
    const { sql, calls } = makeSql();
    const conversation: TextConversationRow = {
      id: "conv-1",
      tenantId: "t1",
      channel: "sms",
      phoneE164: "+15551234567",
      customerId: null,
      widgetSessionTokenHash: null,
      callLogId: null,
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
    };

    await saveConversationPatch(sql, conversation, {
      appendTurns: [
        { role: "user", text: "hi there", at: new Date(0).toISOString() },
        { role: "assistant", text: "hello! how can I help?", at: new Date(1).toISOString() },
      ],
    });

    const transcriptInserts = calls.filter((c) =>
      c.text.includes("insert into public.text_conversation_messages"),
    );
    expect(transcriptInserts).toHaveLength(2);
    expect(transcriptInserts[0]?.values).toEqual(["t1", "conv-1", "customer", "hi there"]);
    expect(transcriptInserts[1]?.values).toEqual(["t1", "conv-1", "ai", "hello! how can I help?"]);
  });

  it("writes no transcript rows when appendTurns is omitted/empty", async () => {
    const { sql, calls } = makeSql();
    const conversation: TextConversationRow = {
      id: "conv-1",
      tenantId: "t1",
      channel: "sms",
      phoneE164: "+15551234567",
      customerId: null,
      widgetSessionTokenHash: null,
      callLogId: null,
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
    };

    await saveConversationPatch(sql, conversation, { incrementMessageCount: true });

    expect(
      calls.some((c) => c.text.includes("insert into public.text_conversation_messages")),
    ).toBe(false);
  });
});

describe("resolveTenantTextContext", () => {
  it("resolves business/vertical/a2p fields with safe defaults", async () => {
    const { sql } = makeSql({
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
          price_version: "v2",
        },
      ],
    });
    const ctx = await resolveTenantTextContext(sql, "t1");
    expect(ctx?.businessName).toBe("Acme Dental");
    expect(ctx?.assistantName).toBe("the AI assistant");
    expect(ctx?.cancellationPolicyText).toContain("as soon as possible");
    expect(ctx?.priceVersion).toBe("v2");
  });

  it("returns null when the tenant doesn't resolve", async () => {
    const { sql } = makeSql({});
    const ctx = await resolveTenantTextContext(sql, "missing");
    expect(ctx).toBeNull();
  });
});

describe("isSmsOptedOut / incrementTextMessagesOut", () => {
  it("reads sms_opt_out from customers", async () => {
    const { sql } = makeSql({ "select sms_opt_out": [{ sms_opt_out: true }] });
    expect(await isSmsOptedOut(sql, "t1", "+15551234567")).toBe(true);
  });

  it("defaults to false when no customer row exists", async () => {
    const { sql } = makeSql({});
    expect(await isSmsOptedOut(sql, "t1", "+15551234567")).toBe(false);
  });

  it("upserts usage_daily.text_messages_out", async () => {
    const { sql, calls } = makeSql();
    await incrementTextMessagesOut(sql, "t1", "v1");
    expect(calls.some((c) => c.text.includes("insert into public.usage_daily"))).toBe(true);
  });
});
