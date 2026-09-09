import { describe, expect, it, vi } from "vitest";
import type { SqlClient } from "../_shared/types.ts";
import { processOutreachEvent } from "./handler.ts";

function jsonRes(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function makeSql(fixtures: Record<string, unknown[]> = {}): {
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

describe("processOutreachEvent", () => {
  it("inserts a reply row and updates send_events status on a reply event", async () => {
    const { sql, calls } = makeSql({
      "from public.campaigns": [{ id: "camp_1" }],
      "from public.send_events": [{ id: "se_1", lead_id: "lead_1" }],
    });
    await processOutreachEvent(sql, {
      campaign_external_id: "camp_1",
      lead_email_or_phone: "a@example.com",
      event: "reply",
      body: "sounds interesting",
      occurred_at: "2026-01-01T00:00:00Z",
      provider_message_id: "msg_1",
    });
    expect(calls.some((c) => c.text.includes("insert into public.replies"))).toBe(true);
  });

  it("adds to the suppression list on unsubscribe", async () => {
    const { sql, calls } = makeSql({ "from public.campaigns": [{ id: "camp_1" }] });
    await processOutreachEvent(sql, {
      campaign_external_id: "camp_1",
      lead_email_or_phone: "a@example.com",
      event: "unsubscribe",
      occurred_at: "2026-01-01T00:00:00Z",
    });
    const insert = calls.find((c) => c.text.includes("insert into public.suppression_list"));
    expect(insert?.values).toContain("unsubscribe");
  });

  it("auto-pauses the campaign when the complaint rate crosses 0.3%", async () => {
    const { sql, calls } = makeSql({
      "from public.campaigns": [{ id: "camp_1" }],
      "update public.campaigns c": [{ complaint_rate: 0.005 }],
    });
    await processOutreachEvent(sql, {
      campaign_external_id: "camp_1",
      lead_email_or_phone: "a@example.com",
      event: "complaint",
      occurred_at: "2026-01-01T00:00:00Z",
    });
    const pause = calls.find((c) => c.text.includes("set status = 'paused'"));
    expect(pause).toBeDefined();
  });

  it("does not pause when the complaint rate is below the threshold", async () => {
    const { sql, calls } = makeSql({
      "from public.campaigns": [{ id: "camp_1" }],
      "update public.campaigns c": [{ complaint_rate: 0.001 }],
    });
    await processOutreachEvent(sql, {
      campaign_external_id: "camp_1",
      lead_email_or_phone: "a@example.com",
      event: "complaint",
      occurred_at: "2026-01-01T00:00:00Z",
    });
    const pause = calls.find((c) => c.text.includes("set status = 'paused'"));
    expect(pause).toBeUndefined();
  });

  it("classifies the reply via Claude (haiku, sync) and stores ai_intent when anthropic deps are provided", async () => {
    const { sql, calls } = makeSql({
      "from public.campaigns": [
        { id: "camp_1", provider: "smartlead", external_campaign_id: "ext_1" },
      ],
      "from public.send_events": [{ id: "se_1", lead_id: "lead_1" }],
      "insert into public.replies": [{ id: "reply_1" }],
    });
    const anthropicFetch = vi.fn(async () =>
      jsonRes({ content: [{ type: "text", text: "interested" }] }),
    ) as never;

    await processOutreachEvent(
      sql,
      {
        campaign_external_id: "camp_1",
        lead_email_or_phone: "a@example.com",
        event: "reply",
        body: "sounds interesting, tell me more",
        occurred_at: "2026-01-01T00:00:00Z",
        provider_message_id: "msg_1",
      },
      { anthropic: { fetchImpl: anthropicFetch, apiKey: "key", model: "claude-haiku-4-5" } },
    );

    const classifyUpdate = calls.find((c) => c.text.includes("set ai_intent"));
    expect(classifyUpdate?.values).toContain("interested");
    expect(calls.some((c) => c.text.includes("set status = 'replied'"))).toBe(true);
  });

  it("leaves ai_intent unset when no anthropic deps are provided", async () => {
    const { sql, calls } = makeSql({
      "from public.campaigns": [{ id: "camp_1" }],
      "from public.send_events": [{ id: "se_1", lead_id: "lead_1" }],
      "insert into public.replies": [{ id: "reply_1" }],
    });
    await processOutreachEvent(sql, {
      campaign_external_id: "camp_1",
      lead_email_or_phone: "a@example.com",
      event: "reply",
      body: "not interested",
      occurred_at: "2026-01-01T00:00:00Z",
      provider_message_id: "msg_1",
    });
    expect(calls.some((c) => c.text.includes("set ai_intent"))).toBe(false);
  });

  it("calls the Smartlead pause endpoint when the complaint rate crosses 0.3% and smartlead deps are provided", async () => {
    const { sql } = makeSql({
      "from public.campaigns": [
        { id: "camp_1", provider: "smartlead", external_campaign_id: "ext_1" },
      ],
      "update public.campaigns c": [{ complaint_rate: 0.01 }],
    });
    const smartleadFetch = vi.fn(async () => jsonRes({})) as never;

    await processOutreachEvent(
      sql,
      {
        campaign_external_id: "camp_1",
        lead_email_or_phone: "a@example.com",
        event: "complaint",
        occurred_at: "2026-01-01T00:00:00Z",
      },
      { smartlead: { fetchImpl: smartleadFetch, apiKey: "key" } },
    );

    expect(smartleadFetch).toHaveBeenCalledWith(
      expect.stringContaining("/campaigns/ext_1/status"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
