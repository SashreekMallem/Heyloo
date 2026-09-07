import { describe, expect, it } from "vitest";
import type { SqlClient } from "../_shared/types.js";
import { processInboundSms } from "./handler.js";

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

const BASE_SMS = { MessageSid: "SM1", From: "+15551234567", To: "+15559998888", Body: "hi" };

describe("processInboundSms", () => {
  it("no-ops when the tenant cannot be resolved for the To number", async () => {
    const { sql, calls } = makeSql({});
    const result = await processInboundSms(sql, { ...BASE_SMS });
    expect(result).toEqual({});
    expect(calls.some((c) => c.includes("insert into public.messages_inbound"))).toBe(false);
  });

  it("sets sms_opt_out=true and replies with the compliance message on STOP", async () => {
    const { sql, calls } = makeSql({ "from public.phone_numbers": [{ tenant_id: "t1" }] });
    const result = await processInboundSms(sql, { ...BASE_SMS, Body: "STOP" });
    expect(result.replyBody).toContain("unsubscribed");
    expect(calls.some((c) => c.includes("sms_opt_out = true"))).toBe(true);
  });

  it("clears sms_opt_out on START", async () => {
    const { sql, calls } = makeSql({ "from public.phone_numbers": [{ tenant_id: "t1" }] });
    const result = await processInboundSms(sql, { ...BASE_SMS, Body: "START" });
    expect(result.replyBody).toContain("resubscribed");
    expect(calls.some((c) => c.includes("sms_opt_out = false"))).toBe(true);
  });

  it("replies with static help text on HELP, without touching opt-out state", async () => {
    const { sql, calls } = makeSql({ "from public.phone_numbers": [{ tenant_id: "t1" }] });
    const result = await processInboundSms(sql, { ...BASE_SMS, Body: "HELP" });
    expect(result.replyBody).toContain("Heyloo AI assistant");
    expect(calls.some((c) => c.includes("sms_opt_out"))).toBe(false);
  });

  it("stores an ordinary inbound message with no auto-reply", async () => {
    const { sql, calls } = makeSql({ "from public.phone_numbers": [{ tenant_id: "t1" }] });
    const result = await processInboundSms(sql, { ...BASE_SMS, Body: "What time do you open?" });
    expect(result).toEqual({});
    expect(calls.some((c) => c.includes("insert into public.messages_inbound"))).toBe(true);
  });
});
