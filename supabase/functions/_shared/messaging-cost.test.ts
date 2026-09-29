import { describe, expect, it } from "vitest";
import {
  emailUnitCostCents,
  recordMessageCost,
  smsSegments,
  smsUnitCostCents,
} from "./messaging-cost.ts";
import type { SqlClient } from "./types.ts";

function recordingSql(fixtures: Record<string, unknown[]> = {}, failOn?: string) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    if (failOn && text.includes(failOn)) return Promise.reject(new Error("boom"));
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

describe("smsSegments", () => {
  it("bills GSM-7 text at 160 chars for one segment, 153 per part beyond", () => {
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("a".repeat(306))).toBe(2);
    expect(smsSegments("a".repeat(307))).toBe(3);
  });
  it("counts GSM extension characters as two septets", () => {
    expect(smsSegments(`${"a".repeat(159)}€`)).toBe(2); // 159 + 2 = 161 septets
  });
  it("switches to UCS-2 (70 / 67) for non-GSM characters such as emoji", () => {
    expect(smsSegments("hi 😀")).toBe(1);
    expect(smsSegments(`😀${"a".repeat(70)}`)).toBe(2);
  });
});

describe("unit costs", () => {
  it("defaults to the researched price card (Twilio 0.83c + 0.40c carrier fee per segment)", () => {
    expect(smsUnitCostCents("twilio", null)).toBeCloseTo(1.23, 6);
    expect(smsUnitCostCents("telnyx", null)).toBeCloseTo(0.8, 6);
    expect(emailUnitCostCents(null)).toBeCloseTo(0.04, 6);
  });
  it("uses platform_settings.provider_cost_card when present", () => {
    const card = { twilio: { sms_segment_cents: 1, sms_carrier_fee_cents: 0.5 } };
    expect(smsUnitCostCents("twilio", card)).toBe(1.5);
  });
});

describe("recordMessageCost", () => {
  it("writes an idempotent estimate row keyed by the message id", async () => {
    const { sql, calls } = recordingSql();
    await recordMessageCost(sql, {
      tenantId: "t1",
      messageId: "m1",
      relatedCallId: null,
      provider: "twilio",
      kind: "sms",
      body: "a".repeat(200),
    });
    const insert = calls.find((c) => c.text.includes("insert into public.cost_events"));
    expect(insert?.text).toContain("on conflict (provider, product, external_ref)");
    expect(insert?.values).toContain("m1");
    expect(insert?.values).toContain(2); // 200 chars = 2 segments
    expect(insert?.values).toContain(2 * 1.23);
  });

  it("records one email at the Resend per-email price", async () => {
    const { sql, calls } = recordingSql();
    await recordMessageCost(sql, {
      tenantId: "t1",
      messageId: "m2",
      relatedCallId: "c1",
      provider: "resend",
      kind: "email",
    });
    const insert = calls.find((c) => c.text.includes("insert into public.cost_events"));
    expect(insert?.values).toContain("email");
    expect(insert?.values).toContain(0.04);
    expect(insert?.values).toContain("c1");
  });

  it("never throws when the ledger write fails (a sent message must not be retried)", async () => {
    const { sql } = recordingSql({}, "insert into public.cost_events");
    const errors: unknown[] = [];
    await expect(
      recordMessageCost(
        sql,
        {
          tenantId: "t1",
          messageId: "m3",
          relatedCallId: null,
          provider: "telnyx",
          kind: "sms",
          body: "hi",
        },
        (e) => errors.push(e),
      ),
    ).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});
