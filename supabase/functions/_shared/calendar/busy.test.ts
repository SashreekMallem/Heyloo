import { describe, expect, it } from "vitest";
import {
  blocksFromBusy,
  buildCalendarPlan,
  type CalendarBlock,
  chunkTimeRange,
  liveVerdictForResource,
  planCalendarIds,
} from "./busy.ts";

const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";

describe("buildCalendarPlan", () => {
  it("defaults to the primary calendar blocking every resource", () => {
    expect(buildCalendarPlan({}, [])).toEqual({
      connectionCalendarId: "primary",
      resourceCalendars: [],
    });
    expect(buildCalendarPlan(null, null).connectionCalendarId).toBe("primary");
  });

  it("uses metadata.calendarId and per-resource mapped calendars", () => {
    const plan = buildCalendarPlan({ calendarId: "owner@example.com" }, [
      { resource_id: R1, calendar_id: "ana@example.com" },
      { resource_id: R2, calendar_id: "bo@example.com" },
    ]);
    expect(plan).toEqual({
      connectionCalendarId: "owner@example.com",
      resourceCalendars: [
        { resourceId: R1, calendarId: "ana@example.com" },
        { resourceId: R2, calendarId: "bo@example.com" },
      ],
    });
    expect(planCalendarIds(plan)).toEqual([
      "owner@example.com",
      "ana@example.com",
      "bo@example.com",
    ]);
  });

  it("drops malformed rows and a mapping to the connection's own calendar (it already blocks all)", () => {
    const plan = buildCalendarPlan({ calendarId: "  " }, [
      { resource_id: "not-a-uuid", calendar_id: "x@example.com" },
      { resource_id: R1, calendar_id: "" },
      { resource_id: R1, calendar_id: "primary" },
      "junk",
      { resource_id: R2, calendar_id: "bo@example.com" },
    ]);
    expect(plan).toEqual({
      connectionCalendarId: "primary",
      resourceCalendars: [{ resourceId: R2, calendarId: "bo@example.com" }],
    });
  });

  it("two resources sharing one calendar query it once", () => {
    const plan = buildCalendarPlan({}, [
      { resource_id: R1, calendar_id: "team@example.com" },
      { resource_id: R2, calendar_id: "team@example.com" },
    ]);
    expect(planCalendarIds(plan)).toEqual(["primary", "team@example.com"]);
    expect(plan.resourceCalendars).toHaveLength(2);
  });

  it("never plans more calendars than one freeBusy request takes (50)", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      resource_id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
      calendar_id: `cal${i}@example.com`,
    }));
    expect(planCalendarIds(buildCalendarPlan({}, rows))).toHaveLength(50);
  });
});

describe("blocksFromBusy", () => {
  it("connection-calendar intervals block every resource (and are where own bookings get subtracted); mapped ones block their resource", () => {
    const plan = buildCalendarPlan({}, [{ resource_id: R2, calendar_id: "bo@example.com" }]);
    const blocks = blocksFromBusy(plan, {
      primary: [{ start: "2026-10-12T10:00:00.000Z", end: "2026-10-12T11:00:00.000Z" }],
      "bo@example.com": [{ start: "2026-10-12T16:00:00.000Z", end: "2026-10-12T17:00:00.000Z" }],
    });
    expect(blocks).toEqual([
      {
        calendarId: "primary",
        resourceId: null,
        start: "2026-10-12T10:00:00.000Z",
        end: "2026-10-12T11:00:00.000Z",
        subtractOwnBookings: true,
      },
      {
        calendarId: "bo@example.com",
        resourceId: R2,
        start: "2026-10-12T16:00:00.000Z",
        end: "2026-10-12T17:00:00.000Z",
        subtractOwnBookings: false,
      },
    ]);
  });
});

describe("chunkTimeRange", () => {
  const start = Date.parse("2026-10-12T00:00:00.000Z");
  const DAY = 86_400_000;

  it("splits a 60-day range into two 30-day requests with no gap", () => {
    expect(chunkTimeRange(start, start + 60 * DAY)).toEqual([
      { timeMin: "2026-10-12T00:00:00.000Z", timeMax: "2026-11-11T00:00:00.000Z" },
      { timeMin: "2026-11-11T00:00:00.000Z", timeMax: "2026-12-11T00:00:00.000Z" },
    ]);
  });

  it("keeps a short range in one request and caps the last chunk at the end", () => {
    expect(chunkTimeRange(start, start + 22 * DAY)).toHaveLength(1);
    const three = chunkTimeRange(start, start + 61 * DAY);
    expect(three).toHaveLength(3);
    expect(three[2]).toEqual({
      timeMin: "2026-12-11T00:00:00.000Z",
      timeMax: "2026-12-12T00:00:00.000Z",
    });
    for (const chunk of three) {
      expect(Date.parse(chunk.timeMax) - Date.parse(chunk.timeMin)).toBeLessThanOrEqual(30 * DAY);
    }
  });

  it("an empty range asks for nothing", () => {
    expect(chunkTimeRange(start, start)).toEqual([]);
  });
});

describe("liveVerdictForResource", () => {
  const window = { start: "2026-10-12T14:00:00.000Z", end: "2026-10-12T14:30:00.000Z" };
  const block = (overrides: Partial<CalendarBlock>): CalendarBlock => ({
    calendarId: "primary",
    resourceId: null,
    start: "2026-10-12T14:00:00.000Z",
    end: "2026-10-12T14:30:00.000Z",
    subtractOwnBookings: true,
    ...overrides,
  });

  it("passes skipped / unknown through", () => {
    expect(liveVerdictForResource({ status: "skipped" }, R1, window, [])).toBe("skipped");
    expect(liveVerdictForResource({ status: "unknown", reason: "timeout" }, R1, window, [])).toBe(
      "unknown",
    );
  });

  it("a tenant-wide busy block overlapping the window is busy", () => {
    expect(liveVerdictForResource({ status: "checked", blocks: [block({})] }, R1, window, [])).toBe(
      "busy",
    );
  });

  it("half-open: a block ending exactly at the start (or starting at the end) is free", () => {
    const verdict = {
      status: "checked" as const,
      blocks: [
        block({ start: "2026-10-12T13:00:00.000Z", end: "2026-10-12T14:00:00.000Z" }),
        block({ start: "2026-10-12T14:30:00.000Z", end: "2026-10-12T15:00:00.000Z" }),
      ],
    };
    expect(liveVerdictForResource(verdict, R1, window, [])).toBe("free");
  });

  it("a block for another resource never blocks this one", () => {
    const verdict = {
      status: "checked" as const,
      blocks: [block({ resourceId: R2, calendarId: "bo@example.com", subtractOwnBookings: false })],
    };
    expect(liveVerdictForResource(verdict, R1, window, [])).toBe("free");
    expect(liveVerdictForResource(verdict, R2, window, [])).toBe("busy");
  });

  it("Heyloo's own pushed booking covering the busy time is not the owner being busy", () => {
    const verdict = { status: "checked" as const, blocks: [block({})] };
    expect(liveVerdictForResource(verdict, R1, window, [window])).toBe("free");
  });

  it("partly covered by own bookings: the uncovered part still counts", () => {
    const verdict = {
      status: "checked" as const,
      blocks: [block({ start: "2026-10-12T13:30:00.000Z", end: "2026-10-12T15:00:00.000Z" })],
    };
    expect(
      liveVerdictForResource(verdict, R1, window, [
        { start: "2026-10-12T14:00:00.000Z", end: "2026-10-12T14:10:00.000Z" },
        { start: "2026-10-12T14:20:00.000Z", end: "2026-10-12T14:30:00.000Z" },
      ]),
    ).toBe("busy");
    expect(
      liveVerdictForResource(verdict, R1, window, [
        { start: "2026-10-12T13:00:00.000Z", end: "2026-10-12T14:15:00.000Z" },
        { start: new Date("2026-10-12T14:15:00.000Z"), end: new Date("2026-10-12T16:00:00.000Z") },
      ]),
    ).toBe("free");
  });

  it("own bookings are never subtracted from a resource-mapped calendar (the push never writes there)", () => {
    const verdict = {
      status: "checked" as const,
      blocks: [
        block({ resourceId: R1, calendarId: "ana@example.com", subtractOwnBookings: false }),
      ],
    };
    expect(liveVerdictForResource(verdict, R1, window, [window])).toBe("busy");
  });

  it("an unreadable window is unknown, never free", () => {
    expect(
      liveVerdictForResource({ status: "checked", blocks: [] }, R1, { start: "x", end: "y" }, []),
    ).toBe("unknown");
  });
});
