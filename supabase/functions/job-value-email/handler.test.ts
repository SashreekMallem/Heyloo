import { describe, expect, it } from "vitest";
import type { SqlClient } from "../_shared/types.ts";
import type { ValueEmailCandidateRow } from "./handler.ts";
import {
  findValueEmailCandidates,
  formatValueSavedDisplay,
  runValueEmails,
  sendOneValueEmail,
} from "./handler.ts";

function row(overrides: Partial<ValueEmailCandidateRow> = {}): ValueEmailCandidateRow {
  return {
    tenant_id: "t1",
    avg_transaction_value_cents: 17500,
    calls_answered: 12,
    bookings_captured: 3,
    owner_email: "owner@example.com",
    ...overrides,
  };
}

function makeSql(script: (call: number, values: unknown[]) => unknown[]): {
  sql: SqlClient;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  let call = 0;
  const sql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
    call += 1;
    calls.push(values);
    return Promise.resolve(script(call, values));
  }) as SqlClient;
  return { sql, calls };
}

describe("formatValueSavedDisplay", () => {
  it("rounds to whole dollars with thousands separators", () => {
    expect(formatValueSavedDisplay(52500)).toBe("$525");
    expect(formatValueSavedDisplay(123456789)).toBe("$1,234,568");
    expect(formatValueSavedDisplay(0)).toBe("$0");
  });
});

describe("sendOneValueEmail", () => {
  it("skips a tenant with no resolvable owner email, writing nothing", async () => {
    const { sql, calls } = makeSql(() => []);
    const outcome = await sendOneValueEmail(sql, row({ owner_email: null }));
    expect(outcome).toBe("skipped_no_owner_email");
    expect(calls).toHaveLength(0);
  });

  it("inserts messages_outbound with the computed value_saved figures and enqueues it", async () => {
    const { sql, calls } = makeSql((call) => (call === 1 ? [{ id: "msg1" }] : []));
    const outcome = await sendOneValueEmail(sql, row());
    expect(outcome).toBe("sent");
    const insertValues = calls[0];
    expect(insertValues).toContain("t1");
    expect(insertValues).toContain("owner@example.com");
    const payloadJson = insertValues?.find(
      (v): v is string => typeof v === "string" && v.includes("value_saved_cents"),
    );
    expect(payloadJson).toBeDefined();
    const payload = JSON.parse(payloadJson as string) as { value_saved_cents: number };
    expect(payload.value_saved_cents).toBe(17500 * 3);
    // second sql call is the enqueue (pgmq.send)
    expect(calls[1]).toContain("messages_outbound_queue");
  });
});

describe("findValueEmailCandidates / runValueEmails", () => {
  it("passes through whatever rows the query returns", async () => {
    const { sql } = makeSql(() => [row()]);
    const rows = await findValueEmailCandidates(sql);
    expect(rows).toHaveLength(1);
  });

  it("sends to every candidate with an owner email and skips the rest", async () => {
    let call = 0;
    const sql = ((_strings: TemplateStringsArray, ..._values: unknown[]) => {
      call += 1;
      if (call === 1) {
        return Promise.resolve([
          row({ tenant_id: "t1", owner_email: "a@example.com" }),
          row({ tenant_id: "t2", owner_email: null }),
        ]);
      }
      return Promise.resolve([{ id: "msg1" }]);
    }) as SqlClient;

    const result = await runValueEmails(sql);
    expect(result).toEqual({ sent: 1, skipped_no_owner_email: 1, total: 2 });
  });
});
