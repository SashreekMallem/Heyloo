import { beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../crypto.ts";
import type { SqlClient } from "../types.ts";
import type { CalendarBusyCheck } from "./busy.ts";
import {
  LIVE_CHECK_CACHE_TTL_MS,
  LIVE_CHECK_NEGATIVE_CACHE_TTL_MS,
  LIVE_CHECK_TIMEOUT_MS,
  LiveConnectionCache,
  makeCalendarLiveCheck,
  startLiveCalendarCheck,
} from "./live-check.ts";

const KEY = btoa("abcdefghijklmnopqrstuvwxyz012345");
const NOW = Date.parse("2026-10-11T12:00:00.000Z");
const RANGE = { start: "2026-10-12T14:00:00.000Z", end: "2026-10-12T14:30:00.000Z" };
const R2 = "22222222-2222-4222-8222-222222222222";

let ACCESS: string;
let REFRESH: string;
beforeAll(async () => {
  ACCESS = await encryptSecret("access-1", KEY);
  REFRESH = await encryptSecret("refresh-1", KEY);
});

const CLIENT = { clientId: "client-id", clientSecret: "client-secret" };

/** Routes the OAuth token endpoint and freeBusy to separate canned answers. */
function routedFetch(token: { body: unknown; status?: number }, busy: unknown) {
  const tokenRequests: string[] = [];
  const busyAuth: (string | undefined)[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("oauth2.googleapis.com")) {
      tokenRequests.push(String(init?.body));
      return Response.json(token.body, { status: token.status ?? 200 });
    }
    busyAuth.push((init?.headers as Record<string, string> | undefined)?.["authorization"]);
    return Response.json(busy);
  }) as typeof fetch;
  return { fetchImpl, tokenRequests, busyAuth };
}

function lookupSql(rows: unknown[] | (() => Promise<unknown[]>)) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join(" "), values });
    return typeof rows === "function" ? rows() : rows;
  }) as SqlClient;
  return { sql, calls };
}

function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    access_token: ACCESS,
    expires_at: new Date(NOW + 30 * 60_000).toISOString(),
    metadata: { calendarId: "primary" },
    resource_calendars: [],
    ...overrides,
  };
}

function busyFetch(body: unknown, status = 200) {
  const requests: { body: unknown; signal: AbortSignal | undefined; auth: string | undefined }[] =
    [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    requests.push({
      body: JSON.parse(String(init?.body)),
      signal: init?.signal ?? undefined,
      auth: (init?.headers as Record<string, string> | undefined)?.["authorization"],
    });
    return Response.json(body, { status });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

describe("makeCalendarLiveCheck", () => {
  it("no connected calendar: skipped, and the answer is cached for the isolate", async () => {
    const { sql, calls } = lookupSql([]);
    const { fetchImpl, requests } = busyFetch({});
    const cache = new LiveConnectionCache();
    const check = makeCalendarLiveCheck(sql, {
      fetchImpl,
      tokenEncryptionKey: KEY,
      cache,
      now: () => NOW,
    });
    const signal = new AbortController().signal;
    expect(await check("t1", RANGE, signal)).toEqual({ status: "skipped" });
    expect(await check("t1", RANGE, signal)).toEqual({ status: "skipped" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("calendar_live_check:connection");
    expect(calls[0]?.text).toContain("provider = 'google_calendar' and c.status = 'connected'");
    expect(calls[0]?.values).toEqual(["t1"]);
    expect(requests).toHaveLength(0);
  });

  it("a connection is cached for 60 s, 'no connection' for 10 minutes", async () => {
    expect(LIVE_CHECK_CACHE_TTL_MS).toBe(60_000);
    expect(LIVE_CHECK_NEGATIVE_CACHE_TTL_MS).toBe(600_000);
    const connected = lookupSql([connectionRow()]);
    const none = lookupSql([]);
    let now = NOW;
    const config = {
      fetchImpl: busyFetch({ calendars: { primary: { busy: [] } } }).fetchImpl,
      tokenEncryptionKey: KEY,
      now: () => now,
    };
    const withCalendar = makeCalendarLiveCheck(connected.sql, {
      ...config,
      cache: new LiveConnectionCache(),
    });
    const withoutCalendar = makeCalendarLiveCheck(none.sql, {
      ...config,
      cache: new LiveConnectionCache(),
    });
    const signal = new AbortController().signal;
    await withCalendar("t1", RANGE, signal);
    await withoutCalendar("t2", RANGE, signal);
    now += 61_000;
    await withCalendar("t1", RANGE, signal);
    await withoutCalendar("t2", RANGE, signal);
    expect(connected.calls).toHaveLength(2);
    expect(none.calls).toHaveLength(1);
    now += 10 * 60_000;
    await withoutCalendar("t2", RANGE, signal);
    expect(none.calls).toHaveLength(2);
  });

  it("asks Google for exactly the booking window, with the stored token, and returns canonical blocks", async () => {
    const { sql } = lookupSql([
      connectionRow({ resource_calendars: [{ resource_id: R2, calendar_id: "bo@example.com" }] }),
    ]);
    const { fetchImpl, requests } = busyFetch({
      calendars: {
        primary: { busy: [{ start: RANGE.start, end: RANGE.end }] },
        "bo@example.com": { busy: [] },
      },
    });
    const check = makeCalendarLiveCheck(sql, {
      fetchImpl,
      tokenEncryptionKey: KEY,
      cache: new LiveConnectionCache(),
      now: () => NOW,
    });
    const signal = new AbortController().signal;
    expect(await check("t1", RANGE, signal)).toEqual({
      status: "checked",
      blocks: [
        {
          calendarId: "primary",
          resourceId: null,
          start: RANGE.start,
          end: RANGE.end,
          subtractOwnBookings: true,
        },
      ],
    });
    expect(requests[0]?.body).toEqual({
      timeMin: RANGE.start,
      timeMax: RANGE.end,
      items: [{ id: "primary" }, { id: "bo@example.com" }],
    });
    expect(requests[0]?.auth).toBe("Bearer access-1");
    expect(requests[0]?.signal).toBe(signal);
  });

  it("without Google client credentials, a (nearly) expired token reads unknown without calling Google", async () => {
    const { sql } = lookupSql([
      connectionRow({ expires_at: new Date(NOW + 10_000).toISOString() }),
    ]);
    const { fetchImpl, requests } = busyFetch({});
    const check = makeCalendarLiveCheck(sql, {
      fetchImpl,
      tokenEncryptionKey: KEY,
      cache: new LiveConnectionCache(),
      now: () => NOW,
    });
    expect(await check("t1", RANGE, new AbortController().signal)).toEqual({
      status: "unknown",
      reason: "token_expired",
    });
    expect(requests).toHaveLength(0);
  });

  it("an expired token is refreshed under the deadline, used, and reused from the isolate cache", async () => {
    const { sql, calls } = lookupSql([
      connectionRow({ expires_at: new Date(NOW - 60_000).toISOString(), refresh_token: REFRESH }),
    ]);
    const { fetchImpl, tokenRequests, busyAuth } = routedFetch(
      { body: { access_token: "access-2", expires_in: 3600, token_type: "Bearer" } },
      { calendars: { primary: { busy: [] } } },
    );
    const cache = new LiveConnectionCache();
    let now = NOW;
    const check = makeCalendarLiveCheck(sql, {
      fetchImpl,
      tokenEncryptionKey: KEY,
      cache,
      googleClient: CLIENT,
      now: () => now,
    });
    expect(await check("t1", RANGE, new AbortController().signal)).toEqual({
      status: "checked",
      blocks: [],
    });
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]).toContain("refresh_token=refresh-1");
    expect(tokenRequests[0]).toContain("grant_type=refresh_token");
    expect(busyAuth).toEqual(["Bearer access-2"]);
    // After the connection cache lapses the stored (stale) token is re-read,
    // but the isolate's fresh token is reused: no second refresh.
    now = NOW + LIVE_CHECK_CACHE_TTL_MS + 1;
    await check("t1", RANGE, new AbortController().signal);
    expect(calls).toHaveLength(2);
    expect(tokenRequests).toHaveLength(1);
    expect(busyAuth).toEqual(["Bearer access-2", "Bearer access-2"]);
  });

  it("a refused refresh reads unknown, skips freeBusy, and forgets the tenant", async () => {
    const { sql, calls } = lookupSql([
      connectionRow({ expires_at: new Date(NOW - 60_000).toISOString(), refresh_token: REFRESH }),
    ]);
    const { fetchImpl, tokenRequests, busyAuth } = routedFetch(
      { body: { error: "invalid_grant" }, status: 400 },
      { calendars: { primary: { busy: [] } } },
    );
    const check = makeCalendarLiveCheck(sql, {
      fetchImpl,
      tokenEncryptionKey: KEY,
      cache: new LiveConnectionCache(),
      googleClient: CLIENT,
      now: () => NOW,
    });
    expect(await check("t1", RANGE, new AbortController().signal)).toEqual({
      status: "unknown",
      reason: "token_refresh_failed",
    });
    expect(tokenRequests).toHaveLength(1);
    expect(busyAuth).toHaveLength(0);
    await check("t1", RANGE, new AbortController().signal);
    expect(calls).toHaveLength(2);
  });

  it("no stored refresh token: an expired token reads unknown even with client credentials", async () => {
    const { sql } = lookupSql([
      connectionRow({ expires_at: new Date(NOW - 60_000).toISOString(), refresh_token: null }),
    ]);
    const { fetchImpl, tokenRequests } = routedFetch({ body: {} }, {});
    const check = makeCalendarLiveCheck(sql, {
      fetchImpl,
      tokenEncryptionKey: KEY,
      cache: new LiveConnectionCache(),
      googleClient: CLIENT,
      now: () => NOW,
    });
    expect(await check("t1", RANGE, new AbortController().signal)).toEqual({
      status: "unknown",
      reason: "token_expired",
    });
    expect(tokenRequests).toHaveLength(0);
  });

  it("a Google failure (errors[], 5xx, 401) reads unknown; a 401 drops the cached connection", async () => {
    const { sql, calls } = lookupSql([connectionRow()]);
    const cache = new LiveConnectionCache();
    const errors = makeCalendarLiveCheck(sql, {
      fetchImpl: busyFetch({
        calendars: {
          primary: { busy: [], errors: [{ domain: "global", reason: "internalError" }] },
        },
      }).fetchImpl,
      tokenEncryptionKey: KEY,
      cache,
      now: () => NOW,
    });
    expect(await errors("t1", RANGE, new AbortController().signal)).toEqual({
      status: "unknown",
      reason: "calendar_error",
    });
    const unauthorized = makeCalendarLiveCheck(sql, {
      fetchImpl: busyFetch({}, 401).fetchImpl,
      tokenEncryptionKey: KEY,
      cache,
      now: () => NOW,
    });
    expect(await unauthorized("t1", RANGE, new AbortController().signal)).toEqual({
      status: "unknown",
      reason: "auth",
    });
    expect(calls).toHaveLength(1);
    await unauthorized("t1", RANGE, new AbortController().signal);
    expect(calls).toHaveLength(2);
  });

  it("a lookup error reads unknown, never throws", async () => {
    const { sql } = lookupSql(() => Promise.reject(new Error("statement timeout")));
    const check = makeCalendarLiveCheck(sql, {
      fetchImpl: busyFetch({}).fetchImpl,
      tokenEncryptionKey: KEY,
      cache: new LiveConnectionCache(),
    });
    expect(await check("t1", RANGE, new AbortController().signal)).toEqual({
      status: "unknown",
      reason: "error",
    });
  });
});

describe("startLiveCalendarCheck", () => {
  it("defaults to an 800 ms deadline", () => {
    expect(LIVE_CHECK_TIMEOUT_MS).toBe(800);
  });

  it("settles unknown/timeout at the deadline and aborts the request, even if the check ignores its signal", async () => {
    let seen: AbortSignal | undefined;
    const check: CalendarBusyCheck = (_t, _r, signal) => {
      seen = signal;
      return new Promise(() => {});
    };
    const started = Date.now();
    const { verdict } = startLiveCalendarCheck(check, "t1", RANGE, 30);
    expect(await verdict).toEqual({ status: "unknown", reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(seen?.aborted).toBe(true);
  });

  it("returns the check's own answer when it beats the deadline", async () => {
    const check: CalendarBusyCheck = async () => ({ status: "checked", blocks: [] });
    const { verdict } = startLiveCalendarCheck(check, "t1", RANGE, 1_000);
    expect(await verdict).toEqual({ status: "checked", blocks: [] });
  });

  it("a rejecting check is unknown/error, never a rejection", async () => {
    const check: CalendarBusyCheck = () => Promise.reject(new Error("boom"));
    expect(await startLiveCalendarCheck(check, "t1", RANGE, 1_000).verdict).toEqual({
      status: "unknown",
      reason: "error",
    });
  });

  it("cancel() aborts an in-flight check and leaves no timer behind", async () => {
    vi.useFakeTimers();
    try {
      let seen: AbortSignal | undefined;
      const check: CalendarBusyCheck = (_t, _r, signal) => {
        seen = signal;
        return new Promise((resolve) =>
          signal.addEventListener("abort", () => resolve({ status: "unknown", reason: "timeout" })),
        );
      };
      const live = startLiveCalendarCheck(check, "t1", RANGE, 800);
      live.cancel();
      expect(seen?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      await expect(live.verdict).resolves.toEqual({ status: "unknown", reason: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
});
