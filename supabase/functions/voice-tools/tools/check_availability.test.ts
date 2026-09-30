import { describe, expect, it } from "vitest";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import {
  checkAvailability,
  DEFAULT_MIN_NOTICE_MINUTES,
  INVALID_DATE_RANGE_MESSAGE,
  minNoticeMinutes,
} from "./check_availability.ts";

const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
  vertical: "restaurant",
  isTestCall: false,
};

const dateRange = { start: "2026-01-15T00:00:00.000Z", end: "2026-01-16T00:00:00.000Z" };

function makeStepSql(steps: { rows: unknown[] }[]): SqlClient {
  let i = 0;
  return (() => {
    const step = steps[i];
    i += 1;
    return Promise.resolve(step?.rows ?? []);
  }) as SqlClient;
}

describe("checkAvailability", () => {
  it("returns slots when the DB has open availability", async () => {
    const sql = makeStepSql([
      {
        rows: [
          {
            resource_id: "res_1",
            slot_start: "2026-01-15T18:00:00.000Z",
            slot_end: "2026-01-15T19:00:00.000Z",
          },
        ],
      },
    ]);
    const result = await checkAvailability(sql, ctx, { date_range: dateRange });
    expect(result).toEqual({
      slots: [
        {
          start: "2026-01-15T18:00:00.000Z",
          end: "2026-01-15T19:00:00.000Z",
          resource_id: "res_1",
        },
      ],
      none_available: false,
    });
  });

  it("returns none_available with a nearest_alternative when nothing matches the window", async () => {
    const sql = makeStepSql([
      { rows: [] }, // primary window query
      {
        rows: [
          {
            resource_id: "res_1",
            slot_start: "2026-01-17T18:00:00.000Z",
            slot_end: "2026-01-17T19:00:00.000Z",
          },
        ],
      }, // nearest-alternative query
    ]);
    const result = await checkAvailability(sql, ctx, { date_range: dateRange });
    expect(result).toEqual({
      slots: [],
      none_available: true,
      nearest_alternative: { start: "2026-01-17T18:00:00.000Z", end: "2026-01-17T19:00:00.000Z" },
    });
  });

  it("returns none_available with no nearest_alternative when there truly is nothing upcoming", async () => {
    const sql = makeStepSql([{ rows: [] }, { rows: [] }]);
    const result = await checkAvailability(sql, ctx, { date_range: dateRange });
    expect(result).toEqual({ slots: [], none_available: true });
  });

  it("passes room_type and party_size through as query parameters (GAP_REGISTER.md §2 Motel item 2 / Restaurant item 3)", async () => {
    let capturedValues: unknown[] = [];
    const sql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
      capturedValues = values;
      return Promise.resolve([]);
    }) as SqlClient;
    await checkAvailability(sql, ctx, {
      date_range: dateRange,
      resource_type: "room",
      room_type: "queen",
      party_size: 4,
    });
    expect(capturedValues).toContain("room");
    expect(capturedValues).toContain("queen");
    expect(capturedValues).toContain(4);
  });

  it("20260910170000_motel_hold_exclusion.sql: a resource whose only slot is held (is_available=false, flipped by the extended fn_invalidate_availability_on_booking trigger for an active scheduled deposit hold) never appears in the returned slots", async () => {
    // The trigger fix means a held resource's row in availability_slots
    // never has is_available=true in the first place, so this tool's own
    // `where is_available = true` filter (unchanged) is what excludes it —
    // this test locks in that a query result containing only the open
    // (non-held) resource's row surfaces exclusively that resource, never
    // the held one, once the fix is applied at the trigger level.
    const sql = makeStepSql([
      {
        rows: [
          {
            resource_id: "res_open",
            slot_start: "2026-01-15T18:00:00.000Z",
            slot_end: "2026-01-16T18:00:00.000Z",
          },
        ],
      },
    ]);
    const result = await checkAvailability(sql, ctx, {
      date_range: dateRange,
      room_type: "queen",
    });
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]?.resource_id).toBe("res_open");
    expect(result.slots.some((s) => s.resource_id === "res_held")).toBe(false);
  });

  it("omits room_type/party_size from the query params when not provided", async () => {
    let capturedValues: unknown[] = [];
    const sql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
      capturedValues = values;
      return Promise.resolve([{ resource_id: "res_1", slot_start: "a", slot_end: "b" }]);
    }) as SqlClient;
    await checkAvailability(sql, ctx, { date_range: dateRange });
    // Every value is a tenant id, a date bound, a null filter, or the
    // HOTPATH minimum-notice minutes — never a stray room_type/party_size.
    expect(
      capturedValues.every(
        (v) => v === null || typeof v === "string" || v === minNoticeMinutes(ctx.vertical),
      ),
    ).toBe(true);
    expect(capturedValues).not.toContain(undefined);
  });
});

describe("checkAvailability — HOTPATH: never offers a slot that has already started", () => {
  function recordingSql(replies: unknown[][]): {
    sql: SqlClient;
    calls: { text: string; values: unknown[] }[];
  } {
    const calls: { text: string; values: unknown[] }[] = [];
    let i = 0;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join(" "), values });
      const rows = replies[i] ?? [];
      i += 1;
      return Promise.resolve(rows);
    }) as SqlClient;
    return { sql, calls };
  }

  it("uses 30 minutes' notice by default and 15 for restaurant tables", () => {
    expect(DEFAULT_MIN_NOTICE_MINUTES).toBe(30);
    expect(minNoticeMinutes("auto")).toBe(30);
    expect(minNoticeMinutes("dental")).toBe(30);
    expect(minNoticeMinutes("restaurant")).toBe(15);
  });

  it("filters the window query to slots starting at least the notice period from now(), keeping a day-length slot (motel night) that has not ended yet", async () => {
    const { sql, calls } = recordingSql([[]]);
    await checkAvailability(sql, { ...ctx, vertical: "auto" }, { date_range: dateRange });
    const window = calls[0];
    expect(window?.text).toContain("lower(slot_range) >= now() + make_interval(mins =>");
    // HOTPATH-REVIEW: 23 hours, so the 23-hour spring-forward motel night
    // still counts as a day-length slot after local midnight.
    expect(window?.text).toContain("upper(slot_range) - lower(slot_range) >= interval '23 hours'");
    expect(window?.text).not.toContain("interval '1 day'");
    expect(window?.text).toContain("upper(slot_range) > now() + make_interval(mins =>");
    // The vertical default is bound once, as the fallback of the tenant's own
    // booking_min_notice_minutes (VOICE-ALERTS-1).
    expect(window?.values.filter((v) => v === 30)).toHaveLength(1);
    expect(window?.text).toContain("booking_min_notice_minutes");
  });

  it("VOICE-ALERTS-1: reads the owner's minimum notice without naming the column, so it still answers on a database that has not applied 20260929140000 yet", async () => {
    const { sql, calls } = recordingSql([[], []]);
    await checkAvailability(sql, ctx, { date_range: dateRange });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.text).toContain("to_jsonb(tn) ->> 'booking_min_notice_minutes'");
      expect(call.text).not.toContain("tn.booking_min_notice_minutes");
      expect(call.text).not.toContain("select booking_min_notice_minutes");
      expect(call.text).toContain("coalesce(");
      expect(call.text).toContain("make_interval(mins => (select notice from t))");
    }
  });

  it("VOICE-ALERTS-1: never offers a slot of an inactive resource, with or without a type filter", async () => {
    const { sql, calls } = recordingSql([[], []]);
    await checkAvailability(sql, ctx, { date_range: dateRange });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.text).toContain("and resource_id in (");
      expect(call.text).toContain("where tenant_id = ");
      expect(call.text).toContain("and active");
      // The old shape skipped the resource check when no filter was given.
      expect(call.text).not.toContain("is null and");
    }
  });

  it("applies the same cutoff to the nearest-alternative query, so a request for a past window is pointed at the next upcoming slot", async () => {
    const { sql, calls } = recordingSql([[], []]);
    await checkAvailability(
      sql,
      { ...ctx, vertical: "restaurant" },
      {
        date_range: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
      },
    );
    const alternative = calls[1];
    expect(alternative?.text).toContain("lower(slot_range) >=");
    expect(alternative?.text).toContain("now() + make_interval(mins =>");
    expect(alternative?.values.filter((v) => v === 15)).toHaveLength(1);
  });

  it("renders slot times in the tenant's timezone with an explicit offset (same instant as the stored UTC value)", async () => {
    const { sql } = recordingSql([
      [
        {
          resource_id: "res_1",
          slot_start: new Date("2026-07-15T14:00:00.000Z"),
          slot_end: new Date("2026-07-15T14:30:00.000Z"),
          tz: "America/New_York",
        },
      ],
    ]);
    const result = await checkAvailability(sql, ctx, { date_range: dateRange });
    expect(result.slots).toEqual([
      {
        start: "2026-07-15T10:00:00-04:00",
        end: "2026-07-15T10:30:00-04:00",
        resource_id: "res_1",
      },
    ]);
    expect(Date.parse(result.slots[0]?.start ?? "")).toBe(Date.parse("2026-07-15T14:00:00.000Z"));
  });

  it("renders the nearest alternative in the tenant's timezone too", async () => {
    const { sql } = recordingSql([
      [],
      [
        {
          resource_id: "res_1",
          slot_start: new Date("2026-01-17T18:00:00.000Z"),
          slot_end: new Date("2026-01-17T18:30:00.000Z"),
          tz: "America/Los_Angeles",
        },
      ],
    ]);
    const result = await checkAvailability(sql, ctx, { date_range: dateRange });
    expect(result.nearest_alternative).toEqual({
      start: "2026-01-17T10:00:00-08:00",
      end: "2026-01-17T10:30:00-08:00",
    });
  });
});

describe("checkAvailability — HOTPATH-REVIEW: time arguments are parsed before any SQL", () => {
  function recordingSql(): { sql: SqlClient; calls: { text: string; values: unknown[] }[] } {
    const calls: { text: string; values: unknown[] }[] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join(" "), values });
      return Promise.resolve([]);
    }) as SqlClient;
    return { sql, calls };
  }

  it("answers invalid_time with an instruction and issues NO statement for a date JavaScript cannot parse (the stock serializer would throw inside the client)", async () => {
    for (const date_range of [
      { start: "today", end: "2026-01-16T00:00:00Z" },
      { start: "2026-01-15T00:00:00Z", end: "tonight" },
      { start: "2026-01-16T00:00:00Z", end: "2026-01-15T00:00:00Z" },
    ]) {
      const { sql, calls } = recordingSql();
      const result = await checkAvailability(sql, ctx, { date_range });
      expect(result).toEqual({
        slots: [],
        none_available: true,
        reason: "invalid_time",
        message: INVALID_DATE_RANGE_MESSAGE,
      });
      expect(calls).toHaveLength(0);
    }
  });

  it("binds the normalized instants (what postgres.js would send anyway), never the raw strings", async () => {
    const { sql, calls } = recordingSql();
    await checkAvailability(sql, ctx, {
      date_range: { start: "2026-01-15T00:00:00-05:00", end: "2026-01-16T00:00:00-05:00" },
    });
    expect(calls[0]?.values).toContain("2026-01-15T05:00:00.000Z");
    expect(calls[0]?.values).toContain("2026-01-16T05:00:00.000Z");
    expect(calls[1]?.values).toContain("2026-01-16T05:00:00.000Z");
    for (const call of calls) {
      expect(call.values).not.toContain("2026-01-15T00:00:00-05:00");
      expect(call.values).not.toContain("2026-01-16T00:00:00-05:00");
    }
  });

  it("still answers an empty window (the same date twice) by querying, as before, so the nearest alternative is offered", async () => {
    const { sql, calls } = recordingSql();
    const result = await checkAvailability(sql, ctx, {
      date_range: { start: "2026-01-15", end: "2026-01-15" },
    });
    expect(calls).toHaveLength(2);
    expect(result.reason).toBeUndefined();
    expect(result.none_available).toBe(true);
  });
});

describe("F13: room type matching (case-insensitive, and ignored when the tenant configured no tiers)", () => {
  it("compares room_type case-insensitively and falls back to untyped when no resource has a room type", async () => {
    const texts: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      texts.push(strings.join(" "));
      return Promise.resolve([]);
    }) as SqlClient;
    await checkAvailability(sql, ctx, {
      room_type: "Standard queen room",
      date_range: { start: "2026-10-02T00:00:00Z", end: "2026-10-04T00:00:00Z" },
    });
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text).toContain("lower(room_type) = lower(");
      expect(text).toContain("rt.room_type is not null");
      expect(text).toContain("rt.tenant_id =");
      expect(text).not.toMatch(/room_type = \$\{roomType\}\)/);
    }
  });
});
