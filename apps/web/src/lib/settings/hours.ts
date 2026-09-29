import { z } from "zod";

/**
 * SETTINGS-1 (docs/BUILD_NOTES.md): the ONE canonical shape the portal
 * writes to `tenants.business_hours` / `tenants.hours_exceptions`, matching
 * what every backend reader already expects:
 *
 * - `business_hours`: `{ mon: [{open, close}, ...], ..., sun: [] }` — a
 *   closed day is an EMPTY array (`_shared/vertical-defaults.ts`'s
 *   `WEEKDAY_9_5`, `_shared/business-hours.ts`'s `WeeklyBusinessHours`).
 *   `fn_regenerate_availability_slots` iterates the day's array and never
 *   reads a per-window `closed` flag, so the old portal format
 *   (`[{open, close, closed: true}]`) produced bookable slots on "closed"
 *   days — live on SIGNUP-1 Test Auto's Sundays.
 * - `hours_exceptions`: `{date, closed: true, note?}` or
 *   `{date, closed: false, hours: [{open, close}], note?}` — the exact keys
 *   the slot generator (`e.value->'hours'`) and `computeGreetingHoursContext`
 *   read. `date` is always a real `YYYY-MM-DD`: a blank date (`''::date`)
 *   raises 22007 inside the nightly rollforward and would abort it for
 *   every tenant.
 *
 * Reading is tolerant of every shape already stored (legacy portal
 * `closed` flags, `[]` defaults, missing days, blank-date exceptions);
 * writing is strict (open < close, no overlapping windows, real dates).
 */

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export const MAX_WINDOWS_PER_DAY = 3;
export const MAX_EXCEPTIONS = 100;

export interface TimeWindow {
  open: string;
  close: string;
}

export interface DaySchedule {
  closed: boolean;
  windows: TimeWindow[];
}

export type WeekSchedule = Record<DayKey, DaySchedule>;

export interface HoursExceptionInput {
  date: string;
  closed: boolean;
  windows: TimeWindow[];
  note: string;
}

export interface HoursPayload {
  hours: WeekSchedule;
  exceptions: HoursExceptionInput[];
}

export type StoredBusinessHours = Record<DayKey, TimeWindow[]>;

export type StoredHoursException =
  | { date: string; closed: true; note?: string }
  | { date: string; closed: false; hours: TimeWindow[]; note?: string };

export const DEFAULT_WINDOW: TimeWindow = { open: "09:00", close: "17:00" };

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWindow(value: unknown): (TimeWindow & { closed: boolean }) | null {
  if (!isRecord(value)) return null;
  const open = value["open"];
  const close = value["close"];
  if (typeof open !== "string" || typeof close !== "string") return null;
  return { open, close, closed: value["closed"] === true };
}

/** A real calendar date in `YYYY-MM-DD` form (rejects `2026-02-30`, blanks, etc.). */
export function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Editor model from whatever is stored — never throws, every day present. */
export function scheduleFromStored(stored: unknown): WeekSchedule {
  const source = isRecord(stored) ? stored : {};
  const week = {} as WeekSchedule;
  for (const day of DAY_KEYS) {
    const raw = source[day];
    const entries = Array.isArray(raw)
      ? raw.map(readWindow).filter((w): w is TimeWindow & { closed: boolean } => w !== null)
      : [];
    const openWindows = entries
      .filter((w) => !w.closed)
      .map(({ open, close }) => ({ open, close }));
    if (openWindows.length > 0) {
      week[day] = { closed: false, windows: openWindows.slice(0, MAX_WINDOWS_PER_DAY) };
    } else {
      // Closed: `[]`, a missing day, or the legacy `[{..., closed: true}]`.
      // Keep the legacy times so re-opening the day restores them.
      const first = entries[0];
      week[day] = {
        closed: true,
        windows: [first ? { open: first.open, close: first.close } : { ...DEFAULT_WINDOW }],
      };
    }
  }
  return week;
}

/** Editor model for exceptions — drops entries with no real date (they can never be saved or matched). */
export function exceptionsFromStored(stored: unknown): HoursExceptionInput[] {
  if (!Array.isArray(stored)) return [];
  const out: HoursExceptionInput[] = [];
  for (const entry of stored) {
    if (!isRecord(entry)) continue;
    const date = entry["date"];
    if (typeof date !== "string" || !isRealDate(date)) continue;
    const note = typeof entry["note"] === "string" ? entry["note"] : "";
    const hours = Array.isArray(entry["hours"])
      ? entry["hours"]
          .map(readWindow)
          .filter((w): w is TimeWindow & { closed: boolean } => w !== null)
          .map(({ open, close }) => ({ open, close }))
      : [];
    const legacy = readWindow(entry);
    const windows =
      hours.length > 0 ? hours : legacy ? [{ open: legacy.open, close: legacy.close }] : [];
    const closed = entry["closed"] === true || windows.length === 0;
    out.push({
      date,
      closed,
      windows: windows.length > 0 ? windows : [{ ...DEFAULT_WINDOW }],
      note,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function checkWindows(
  windows: TimeWindow[],
  ctx: z.RefinementCtx,
  basePath: (string | number)[],
): void {
  if (windows.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: "Add opening hours or mark it closed.",
      path: basePath,
    });
    return;
  }
  windows.forEach((w, i) => {
    if (!TIME_PATTERN.test(w.open)) {
      ctx.addIssue({
        code: "custom",
        message: "Use a time like 09:00.",
        path: [...basePath, i, "open"],
      });
    }
    if (!TIME_PATTERN.test(w.close)) {
      ctx.addIssue({
        code: "custom",
        message: "Use a time like 17:00.",
        path: [...basePath, i, "close"],
      });
    }
    if (TIME_PATTERN.test(w.open) && TIME_PATTERN.test(w.close) && w.open >= w.close) {
      ctx.addIssue({
        code: "custom",
        message: "Closing time must be after opening time (split overnight hours across two days).",
        path: [...basePath, i, "close"],
      });
    }
  });
  const sorted = [...windows].sort((a, b) => a.open.localeCompare(b.open));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as TimeWindow;
    const next = sorted[i] as TimeWindow;
    if (next.open < prev.close) {
      ctx.addIssue({
        code: "custom",
        message: "These time ranges overlap.",
        path: basePath,
      });
      return;
    }
  }
}

const zWindowShape = z.object({ open: z.string(), close: z.string() });

const zDaySchedule = z
  .object({
    closed: z.boolean(),
    windows: z.array(zWindowShape).max(MAX_WINDOWS_PER_DAY),
  })
  .superRefine((day, ctx) => {
    // A closed day's hidden times are never validated — the owner can't see them.
    if (!day.closed) checkWindows(day.windows, ctx, ["windows"]);
  });

const zException = z
  .object({
    date: z.string().refine(isRealDate, "Pick a date."),
    closed: z.boolean(),
    windows: z.array(zWindowShape).max(MAX_WINDOWS_PER_DAY),
    note: z.string().trim().max(200),
  })
  .superRefine((exception, ctx) => {
    if (!exception.closed) checkWindows(exception.windows, ctx, ["windows"]);
  });

/** Shared by the Hours tab (client) and `POST /api/tenant/settings/hours` (server). */
export const hoursPayloadSchema = z
  .object({
    hours: z.object({
      mon: zDaySchedule,
      tue: zDaySchedule,
      wed: zDaySchedule,
      thu: zDaySchedule,
      fri: zDaySchedule,
      sat: zDaySchedule,
      sun: zDaySchedule,
    }),
    exceptions: z.array(zException).max(MAX_EXCEPTIONS),
  })
  .superRefine((payload, ctx) => {
    const seen = new Map<string, number>();
    payload.exceptions.forEach((exception, index) => {
      const first = seen.get(exception.date);
      if (first !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: "This date already has an exception.",
          path: ["exceptions", index, "date"],
        });
      } else {
        seen.set(exception.date, index);
      }
    });
  });

function sortWindows(windows: TimeWindow[]): TimeWindow[] {
  return [...windows]
    .map(({ open, close }) => ({ open, close }))
    .sort((a, b) => a.open.localeCompare(b.open));
}

/** Canonical `tenants.business_hours` value — closed day = `[]`. */
export function toStoredHours(week: WeekSchedule): StoredBusinessHours {
  const out = {} as StoredBusinessHours;
  for (const day of DAY_KEYS) {
    const schedule = week[day];
    out[day] = schedule.closed ? [] : sortWindows(schedule.windows);
  }
  return out;
}

/** Canonical `tenants.hours_exceptions` value, date-sorted. */
export function toStoredExceptions(exceptions: HoursExceptionInput[]): StoredHoursException[] {
  return [...exceptions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((exception) => {
      const note = exception.note.trim();
      const withNote = note.length > 0 ? { note } : {};
      return exception.closed
        ? { date: exception.date, closed: true as const, ...withNote }
        : {
            date: exception.date,
            closed: false as const,
            hours: sortWindows(exception.windows),
            ...withNote,
          };
    });
}

/** Number of weekdays with at least one open window, from a STORED value (any legacy shape). */
export function countOpenDays(stored: unknown): number {
  const week = scheduleFromStored(stored);
  return DAY_KEYS.filter((day) => !week[day].closed).length;
}

/** Plain-language summary of one day for read-only displays, e.g. "8:00 AM – 12:00 PM, 1:00 PM – 5:00 PM". */
export function formatDaySchedule(day: DaySchedule): string {
  if (day.closed) return "Closed";
  return sortWindows(day.windows)
    .map((w) => `${formatTime12h(w.open)} – ${formatTime12h(w.close)}`)
    .join(", ");
}

export function formatTime12h(hhmm: string): string {
  if (!TIME_PATTERN.test(hhmm)) return hhmm;
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}
