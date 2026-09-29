import { describe, expect, it } from "vitest";
import {
  countOpenDays,
  exceptionsFromStored,
  formatDaySchedule,
  type HoursPayload,
  hoursPayloadSchema,
  isRealDate,
  scheduleFromStored,
  toStoredExceptions,
  toStoredHours,
  type WeekSchedule,
} from "./hours";

const OPEN = { closed: false, windows: [{ open: "09:00", close: "17:00" }] };
const CLOSED = { closed: true, windows: [{ open: "09:00", close: "17:00" }] };

function week(overrides: Partial<WeekSchedule> = {}): WeekSchedule {
  return {
    mon: OPEN,
    tue: OPEN,
    wed: OPEN,
    thu: OPEN,
    fri: OPEN,
    sat: CLOSED,
    sun: CLOSED,
    ...overrides,
  };
}

function payload(overrides: Partial<HoursPayload> = {}): HoursPayload {
  return { hours: week(), exceptions: [], ...overrides };
}

describe("scheduleFromStored", () => {
  it("reads the canonical shape: [] is closed, windows are open", () => {
    const result = scheduleFromStored({
      mon: [{ open: "08:00", close: "18:00" }],
      sun: [],
    });
    expect(result.mon).toEqual({ closed: false, windows: [{ open: "08:00", close: "18:00" }] });
    expect(result.sun.closed).toBe(true);
  });

  it("treats a missing day and a non-object as closed", () => {
    expect(scheduleFromStored({}).wed.closed).toBe(true);
    expect(scheduleFromStored(null).fri.closed).toBe(true);
  });

  it("reads the legacy portal shape [{..., closed: true}] as CLOSED and keeps its times", () => {
    const result = scheduleFromStored({
      sun: [{ open: "09:00", close: "13:00", closed: true }],
      sat: [{ open: "09:00", close: "13:00", closed: false }],
    });
    expect(result.sun).toEqual({ closed: true, windows: [{ open: "09:00", close: "13:00" }] });
    expect(result.sat).toEqual({ closed: false, windows: [{ open: "09:00", close: "13:00" }] });
  });

  it("keeps split shifts", () => {
    const result = scheduleFromStored({
      tue: [
        { open: "08:00", close: "12:00" },
        { open: "13:00", close: "17:00" },
      ],
    });
    expect(result.tue.windows).toHaveLength(2);
  });
});

describe("exceptionsFromStored", () => {
  it("drops blank / invalid dates (they abort the nightly rollforward)", () => {
    expect(
      exceptionsFromStored([
        { date: "", closed: true },
        { date: "2026-02-30", closed: true },
        { date: "2026-11-26", closed: true, note: "Thanksgiving" },
      ]),
    ).toEqual([
      {
        date: "2026-11-26",
        closed: true,
        windows: [{ open: "09:00", close: "17:00" }],
        note: "Thanksgiving",
      },
    ]);
  });

  it("reads special hours from `hours` and from legacy open/close keys", () => {
    const result = exceptionsFromStored([
      { date: "2026-12-24", hours: [{ open: "09:00", close: "12:00" }] },
      { date: "2026-12-31", open: "10:00", close: "14:00" },
    ]);
    expect(result[0]).toMatchObject({
      closed: false,
      windows: [{ open: "09:00", close: "12:00" }],
    });
    expect(result[1]).toMatchObject({
      closed: false,
      windows: [{ open: "10:00", close: "14:00" }],
    });
  });

  it("returns [] for a non-array", () => {
    expect(exceptionsFromStored({})).toEqual([]);
  });
});

describe("hoursPayloadSchema", () => {
  it("accepts a normal week", () => {
    expect(hoursPayloadSchema.safeParse(payload()).success).toBe(true);
  });

  it("rejects closing before opening", () => {
    const result = hoursPayloadSchema.safeParse(
      payload({
        hours: week({ mon: { closed: false, windows: [{ open: "17:00", close: "09:00" }] } }),
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["hours", "mon", "windows", 0, "close"]);
  });

  it("rejects overlapping split shifts", () => {
    const result = hoursPayloadSchema.safeParse(
      payload({
        hours: week({
          tue: {
            closed: false,
            windows: [
              { open: "08:00", close: "13:00" },
              { open: "12:00", close: "17:00" },
            ],
          },
        }),
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an open day with no hours and malformed times", () => {
    expect(
      hoursPayloadSchema.safeParse(
        payload({ hours: week({ wed: { closed: false, windows: [] } }) }),
      ).success,
    ).toBe(false);
    expect(
      hoursPayloadSchema.safeParse(
        payload({
          hours: week({ wed: { closed: false, windows: [{ open: "9am", close: "17:00" }] } }),
        }),
      ).success,
    ).toBe(false);
  });

  it("ignores the hidden times of a closed day", () => {
    const result = hoursPayloadSchema.safeParse(
      payload({
        hours: week({ sun: { closed: true, windows: [{ open: "17:00", close: "09:00" }] } }),
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a blank exception date and duplicate dates", () => {
    const blank = hoursPayloadSchema.safeParse(
      payload({ exceptions: [{ date: "", closed: true, windows: [], note: "" }] }),
    );
    expect(blank.success).toBe(false);
    const dupe = hoursPayloadSchema.safeParse(
      payload({
        exceptions: [
          { date: "2026-12-25", closed: true, windows: [], note: "" },
          { date: "2026-12-25", closed: true, windows: [], note: "again" },
        ],
      }),
    );
    expect(dupe.success).toBe(false);
    expect(dupe.error?.issues[0]?.path).toEqual(["exceptions", 1, "date"]);
  });

  it("requires valid hours for a special-hours exception", () => {
    const result = hoursPayloadSchema.safeParse(
      payload({
        exceptions: [
          {
            date: "2026-12-24",
            closed: false,
            windows: [{ open: "12:00", close: "10:00" }],
            note: "",
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });
});

describe("toStoredHours / toStoredExceptions", () => {
  it("writes a closed day as [] (the only closed shape the slot generator honors)", () => {
    const stored = toStoredHours(week());
    expect(stored.sat).toEqual([]);
    expect(stored.sun).toEqual([]);
    expect(stored.mon).toEqual([{ open: "09:00", close: "17:00" }]);
    expect(JSON.stringify(stored)).not.toContain("closed");
  });

  it("sorts split shifts", () => {
    const stored = toStoredHours(
      week({
        mon: {
          closed: false,
          windows: [
            { open: "13:00", close: "17:00" },
            { open: "08:00", close: "12:00" },
          ],
        },
      }),
    );
    expect(stored.mon[0]?.open).toBe("08:00");
  });

  it("writes closed exceptions and special-hours exceptions in the keys the backend reads", () => {
    expect(
      toStoredExceptions([
        {
          date: "2026-12-25",
          closed: true,
          windows: [{ open: "09:00", close: "17:00" }],
          note: " Christmas ",
        },
        {
          date: "2026-12-24",
          closed: false,
          windows: [{ open: "09:00", close: "12:00" }],
          note: "",
        },
      ]),
    ).toEqual([
      { date: "2026-12-24", closed: false, hours: [{ open: "09:00", close: "12:00" }] },
      { date: "2026-12-25", closed: true, note: "Christmas" },
    ]);
  });

  it("round-trips through scheduleFromStored", () => {
    const original = week({ sat: { closed: false, windows: [{ open: "10:00", close: "14:00" }] } });
    expect(scheduleFromStored(toStoredHours(original)).sat).toEqual(original.sat);
  });
});

describe("helpers", () => {
  it("isRealDate", () => {
    expect(isRealDate("2026-02-28")).toBe(true);
    expect(isRealDate("2026-02-29")).toBe(false);
    expect(isRealDate("2028-02-29")).toBe(true);
    expect(isRealDate("")).toBe(false);
    expect(isRealDate("12/25/2026")).toBe(false);
  });

  it("countOpenDays understands every stored shape", () => {
    expect(countOpenDays({})).toBe(0);
    expect(countOpenDays({ mon: [{ open: "09:00", close: "17:00" }], sun: [] })).toBe(1);
    expect(
      countOpenDays({
        mon: [{ open: "09:00", close: "17:00", closed: false }],
        sun: [{ open: "09:00", close: "13:00", closed: true }],
      }),
    ).toBe(1);
  });

  it("formatDaySchedule", () => {
    expect(formatDaySchedule(CLOSED)).toBe("Closed");
    expect(
      formatDaySchedule({
        closed: false,
        windows: [
          { open: "13:00", close: "17:30" },
          { open: "08:00", close: "12:00" },
        ],
      }),
    ).toBe("8:00 AM – 12:00 PM, 1:00 PM – 5:30 PM");
  });
});
