import { beforeAll, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret, sha256Hex } from "../crypto.ts";
import type { Logger, SqlClient } from "../types.ts";
import {
  CALENDAR_READ_FAILING_ALERT_HOURS,
  CALENDAR_STALE_BLOCKS_HOURS,
  CALENDAR_SYNC_BACKOFF_MINUTES,
  CALENDAR_SYNC_CLAIM_BUDGET_MS,
  CALENDAR_SYNC_CONCURRENCY,
  CALENDAR_SYNC_COVERAGE_SLACK_DAYS,
  CALENDAR_SYNC_ERROR_PREFIX,
  CALENDAR_SYNC_LEASE_SECONDS,
  CALENDAR_SYNC_MAX_HORIZON_DAYS,
  type CalendarBusySyncDeps,
  runCalendarBusySync,
  syncHorizonDays,
  syncReadDays,
  TENANT_DISCONNECT_REASON,
} from "./sync.ts";
import {
  CALENDAR_WATCH_RENEW_BEFORE_HOURS,
  CALENDAR_WATCH_RENEW_MIN_INTERVAL_MINUTES,
  CALENDAR_WATCH_TTL_SECONDS,
} from "./watch.ts";

const KEY = btoa("abcdefghijklmnopqrstuvwxyz012345");
const T1 = "tenant-1";
const NOW = Date.parse("2026-10-11T12:00:30.000Z");
const R2 = "22222222-2222-4222-8222-222222222222";
/** `busy_sync_attempted_at::text` as the claim returns it (microseconds kept). */
const CLAIMED_AT = "2026-10-11 12:00:30.123456+00";
const ADDRESS = "https://ref.supabase.co/functions/v1/webhooks-pos/google_calendar";

let ACCESS: string;
let REFRESH: string;
beforeAll(async () => {
  ACCESS = await encryptSecret("access-1", KEY);
  REFRESH = await encryptSecret("refresh-1", KEY);
});

interface Call {
  text: string;
  values: unknown[];
}

type Reply = unknown[] | ((values: unknown[]) => unknown[] | Promise<unknown[]>);

/** Fake `sql` routed by each statement's marker comment / distinctive text. */
function makeSql(input: Record<string, Reply>) {
  // A refreshed token is stored unless a test says otherwise.
  const routes: Record<string, Reply> = {
    "calendar_busy_sync:token": [{ id: "stored" }],
    ...input,
  };
  const calls: Call[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [key, reply] of Object.entries(routes)) {
      if (text.includes(key)) return typeof reply === "function" ? reply(values) : reply;
    }
    return [];
  }) as SqlClient;
  const marked = (marker: string) => calls.filter((c) => c.text.includes(marker));
  return { sql, calls, marked };
}

/** Claim reply: hands out each connection once (lanes claim one at a time),
 * then nothing is due. */
function claimQueue(...connections: unknown[]): Reply {
  const queue = [...connections];
  return () => (queue.length > 0 ? [queue.shift()] : []);
}

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    tenant_id: T1,
    claimed_at: CLAIMED_AT,
    access_token: ACCESS,
    refresh_token: REFRESH,
    expires_at: new Date(NOW + 3_600_000).toISOString(),
    metadata: { calendarId: "primary" },
    busy_synced_at: new Date(NOW - 5 * 60_000).toISOString(),
    // a requested read on a connection whose push channel is healthy
    watch_channel_id: "chan-old",
    watch_resource_id: "res-old",
    read_due: true,
    channel_due: false,
    channel_live: true,
    horizon_days: 21,
    resource_calendars: [],
    ...overrides,
  };
}

function logger() {
  return {
    debug: vi.fn<Logger["debug"]>(),
    info: vi.fn<Logger["info"]>(),
    warn: vi.fn<Logger["warn"]>(),
    error: vi.fn<Logger["error"]>(),
  };
}

interface FetchCall {
  url: string;
  body: string;
  authorization: string | undefined;
}

interface WatchRequest {
  id: string;
  type: string;
  address: string;
  token: string;
  params: { ttl: string };
}

/** Google stand-in: token endpoint, freeBusy, events.watch and channels.stop,
 * each overridable. */
function googleFetch(opts: {
  token?: () => Response | Promise<Response>;
  freeBusy?: (req: {
    timeMin: string;
    timeMax: string;
    items: { id: string }[];
  }) => Response | Promise<Response>;
  watch?: (req: WatchRequest) => Response | Promise<Response>;
  stop?: (req: { id: string; resourceId: string }) => Response | Promise<Response>;
}) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    calls.push({
      url,
      body,
      authorization: (init?.headers as Record<string, string> | undefined)?.["authorization"],
    });
    if (url.includes("oauth2.googleapis.com/token")) {
      return opts.token
        ? opts.token()
        : Response.json({ access_token: "access-2", expires_in: 3600 });
    }
    if (url.endsWith("/events/watch")) {
      const req = JSON.parse(body) as WatchRequest;
      return opts.watch
        ? opts.watch(req)
        : Response.json({
            kind: "api#channel",
            id: req.id,
            resourceId: "res-new",
            expiration: String(NOW + 7 * 86_400_000),
          });
    }
    if (url.endsWith("/channels/stop")) {
      const req = JSON.parse(body) as { id: string; resourceId: string };
      return opts.stop ? opts.stop(req) : new Response(null, { status: 204 });
    }
    const req = JSON.parse(body) as { timeMin: string; timeMax: string; items: { id: string }[] };
    if (opts.freeBusy) return opts.freeBusy(req);
    return Response.json({
      calendars: Object.fromEntries(req.items.map((i) => [i.id, { busy: [] }])),
    });
  }) as typeof fetch;
  return {
    fetchImpl,
    calls,
    freeBusyCalls: () => calls.filter((c) => c.url.endsWith("/freeBusy")),
    tokenCalls: () => calls.filter((c) => c.url.includes("/token")),
    watchCalls: () => calls.filter((c) => c.url.endsWith("/events/watch")),
    stopCalls: () => calls.filter((c) => c.url.endsWith("/channels/stop")),
  };
}

function deps(
  fetchImpl: typeof fetch,
  overrides: Partial<CalendarBusySyncDeps> = {},
): CalendarBusySyncDeps & { logger: ReturnType<typeof logger> } {
  return {
    fetchImpl,
    tokenEncryptionKey: KEY,
    google: { clientId: "client", clientSecret: "secret" },
    webhookAddress: ADDRESS,
    logger: logger(),
    now: () => NOW,
    ...overrides,
  } as CalendarBusySyncDeps & { logger: ReturnType<typeof logger> };
}

const ALERT_ROUTES = {
  "public.agent_configs ac": [
    { transfer_number: "+15550001111", delivery: null, owner_email: "o@example.com" },
  ],
  "insert into public.messages_outbound": [{ id: "alert-1" }],
};

function replacePayload(call: Call | undefined): {
  blocks: {
    calendar_id: string;
    resource_id: string | null;
    subtract_own: boolean;
    starts: string;
    ends: string;
  }[];
} {
  const payload = call?.values.find(
    (v) => typeof v === "object" && v !== null && "blocks" in (v as object),
  );
  return payload as ReturnType<typeof replacePayload>;
}

describe("syncHorizonDays / syncReadDays", () => {
  it("is the owner's horizon (else 21) plus one day: every day the AI can offer, up to 365 + 1", () => {
    expect(syncHorizonDays(null)).toBe(22);
    expect(syncHorizonDays(30)).toBe(31);
    expect(syncHorizonDays(59)).toBe(60);
    expect(syncHorizonDays(120)).toBe(121);
    expect(syncHorizonDays(365)).toBe(366);
    expect(syncHorizonDays(9999)).toBe(366);
    expect(syncHorizonDays(0)).toBe(22);
  });

  it("a read covers the horizon plus the channel lifetime + 1 day (the longest normal gap between reads)", () => {
    expect(CALENDAR_WATCH_TTL_SECONDS).toBe(7 * 86_400);
    expect(CALENDAR_SYNC_COVERAGE_SLACK_DAYS).toBe(8);
    expect(syncReadDays(null)).toBe(30);
    expect(syncReadDays(21)).toBe(30);
    expect(syncReadDays(365)).toBe(374);
    // the slack outlasts the renewal (a day before the 7-day channel expires)
    expect(CALENDAR_SYNC_COVERAGE_SLACK_DAYS * 24).toBeGreaterThan(
      CALENDAR_WATCH_TTL_SECONDS / 3600 - CALENDAR_WATCH_RENEW_BEFORE_HOURS,
    );
  });
});

describe("runCalendarBusySync — claim and replace", () => {
  it("sweeps stale blocks first, then claims only DUE connections with skip-locked", async () => {
    const { sql, calls } = makeSql({
      "calendar_busy_sync:sweep": [{ removed: 3 }],
      "calendar_busy_sync:claim": [],
    });
    const google = googleFetch({});
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(result).toEqual({
      claimed: 0,
      synced: 0,
      failed: 0,
      needs_reconnect: 0,
      deferred: 0,
      superseded: 0,
      stale_blocks_removed: 3,
      owner_alerts: 0,
      channels_registered: 0,
      channels_failed: 0,
      channels_stopped: 0,
    });
    expect(calls[0]?.text).toContain("calendar_busy_sync:sweep");
    expect(calls[0]?.text).toContain("c.status <> 'connected'");
    expect(calls[0]?.text).toContain("make_interval(hours =>");
    expect(calls[0]?.values).toContain(CALENDAR_STALE_BLOCKS_HOURS);
    // an owner disconnect drops the blocks at once, not after 24 h
    expect(calls[0]?.text).toContain("c.last_error is not distinct from");
    expect(calls[0]?.values).toContain(TENANT_DISCONNECT_REASON);
    expect(TENANT_DISCONNECT_REASON).toBe("tenant-initiated disconnect");
    // mirrored by the web's CALENDAR_SYNC_ERROR_PREFIX ("having trouble" note)
    expect(CALENDAR_SYNC_ERROR_PREFIX).toBe("calendar busy sync: ");
    expect(calls[1]?.text).toContain("calendar_busy_sync:alert_claim");
    const claim = calls[2];
    expect(claim?.text).toContain("calendar_busy_sync:claim");
    // only the connection row is locked (the tenant is joined for its horizon)
    expect(claim?.text).toContain("for update of c skip locked");
    expect(claim?.text).toContain("set busy_sync_attempted_at = now()");
    expect(claim?.text).toContain("provider = 'google_calendar' and c.status = 'connected'");
    // the claim comes back as text so the later equality guards stay exact
    expect(claim?.text).toContain("c.busy_sync_attempted_at::text as claimed_at");
    // one connection per claim; every lane found nothing due and stopped
    expect(claim?.values).toContain(1);
    expect(calls.filter((c) => c.text.includes("calendar_busy_sync:claim"))).toHaveLength(
      CALENDAR_SYNC_CONCURRENCY,
    );
    expect(google.calls).toHaveLength(0);
  });

  it("push-only: a read is due ONLY when requested after the last good read (or its window ran short) — no periodic re-read", async () => {
    const { sql, marked } = makeSql({ "calendar_busy_sync:claim": [] });
    await runCalendarBusySync(sql, deps(googleFetch({}).fetchImpl));
    const claim = marked("calendar_busy_sync:claim")[0];
    const text = claim?.text ?? "";
    // the due-read condition, both in the pick and in the returned flag
    const requested =
      /c\.busy_sync_requested_at is not null\s+and \(c\.busy_synced_at is null or c\.busy_synced_at < c\.busy_sync_requested_at\)/g;
    expect(text.match(requested)).toHaveLength(2);
    // no "claimed again once N minutes old" cadence on a healthy calendar:
    // nothing compares the last read's TIME with now()
    expect(text).not.toMatch(/busy_synced_at < now\(\)/);
    expect(text).not.toContain("make_interval(mins =>  )");
    // the coverage check: a read is due once the last read's window
    // (busy_synced_until) no longer reaches the end of the horizon — the
    // same days syncHorizonDays() asks for, never more
    const coverage =
      /or c\.busy_synced_until is null\s+or c\.busy_synced_until < now\(\) \+ make_interval\(\s*days => least\(greatest\(h\.horizon_days, 1\) \+ 1, {2}\)\)/g;
    expect(text.match(coverage)).toHaveLength(2);
    expect(claim?.values).toContain(CALENDAR_SYNC_MAX_HORIZON_DAYS);
    // the horizon comes from the tenant (vertical default), joined per row
    expect(text).toContain("(to_jsonb(t) ->> 'booking_horizon_days')::int");
    expect(text).toContain("picked.read_due, picked.channel_due, picked.channel_live");
  });

  it("a short lease and the 1/5/15/60-minute retry backoff gate every claim", async () => {
    const { sql, marked } = makeSql({ "calendar_busy_sync:claim": [] });
    await runCalendarBusySync(sql, deps(googleFetch({}).fetchImpl));
    const claim = marked("calendar_busy_sync:claim")[0];
    const text = claim?.text ?? "";
    expect(text).toContain("c.busy_sync_attempted_at < now() - make_interval(secs =>");
    expect(claim?.values).toContain(CALENDAR_SYNC_LEASE_SECONDS);
    expect(CALENDAR_SYNC_BACKOFF_MINUTES).toEqual([1, 5, 15, 60]);
    // the backoff is inlined: N consecutive failures -> wait 1, 5, 15, then 60 minutes
    expect(text).toContain(
      `(array[${CALENDAR_SYNC_BACKOFF_MINUTES.join(", ")}])[least(c.busy_sync_failures, ${CALENDAR_SYNC_BACKOFF_MINUTES.length})]`,
    );
    expect(text).toContain("c.busy_sync_failures = 0");
  });

  it("channel work is claimable when the channel is missing, forced (null expiry) or expiring within a day, once its retry time passed", async () => {
    const { sql, marked } = makeSql({ "calendar_busy_sync:claim": [] });
    await runCalendarBusySync(sql, deps(googleFetch({}).fetchImpl));
    const claim = marked("calendar_busy_sync:claim")[0];
    const text = claim?.text ?? "";
    expect(text).toContain("c.watch_channel_id is null or c.watch_expires_at is null");
    expect(text).toContain("c.watch_expires_at < now() + make_interval(hours =>");
    expect(claim?.values).toContain(CALENDAR_WATCH_RENEW_BEFORE_HOURS);
    // the channel's own backoff/throttle (watch_retry_at), apart from the reads'
    expect(
      text.match(/and \(c\.watch_retry_at is null or c\.watch_retry_at <= now\(\)\)/g),
    ).toHaveLength(2);
    // "live" = a stored channel that has not expired yet (never null: a
    // forced renewal's null expiry is "not live")
    expect(text).toMatch(
      /coalesce\(c\.watch_channel_id is not null and c\.watch_resource_id is not null\s+and c\.watch_expires_at > now\(\), false\) as channel_live/,
    );
    // channels enabled (an HTTPS webhook address is configured)
    expect(claim?.values.filter((v) => v === true).length).toBeGreaterThanOrEqual(2);
  });

  it("without an HTTPS webhook address no channel work is claimed or done", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(
        connection({ channel_due: false, watch_channel_id: null, watch_resource_id: null }),
      ),
      "calendar_busy_sync:replace": [{ synced: true, removed: 0, added: 0 }],
    });
    const google = googleFetch({});
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl, { webhookAddress: null }));
    expect(result).toMatchObject({ synced: 1, channels_registered: 0 });
    const claim = marked("calendar_busy_sync:claim")[0];
    expect(claim?.values).not.toContain(true);
    expect(claim?.values.filter((v) => v === false).length).toBeGreaterThanOrEqual(2);
    expect(google.watchCalls()).toHaveLength(0);
  });

  it("a claimed connection with nothing due after all calls nobody and hands the claim back", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ read_due: false, channel_due: false })),
    });
    const google = googleFetch({});
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(result).toMatchObject({ claimed: 1, synced: 0, deferred: 1 });
    expect(google.calls).toHaveLength(0);
    expect(marked("calendar_busy_sync:release")).toHaveLength(1);
  });

  it("reads freeBusy for now -> horizon and replaces the connection's rows in ONE statement", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection()),
      "calendar_busy_sync:replace": [{ synced: true, removed: 4, added: 1 }],
    });
    const google = googleFetch({
      freeBusy: () =>
        Response.json({
          calendars: {
            primary: { busy: [{ start: "2026-10-12T14:00:00Z", end: "2026-10-12T15:00:00Z" }] },
          },
        }),
    });
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(result).toMatchObject({ claimed: 1, synced: 1, failed: 0, needs_reconnect: 0 });

    // No token refresh: the access token is valid for another hour.
    expect(google.tokenCalls()).toHaveLength(0);
    const [fb] = google.freeBusyCalls();
    expect(fb?.authorization).toBe("Bearer access-1");
    // 21-day horizon + 1 day + 8 days of coverage slack = 30 days
    expect(JSON.parse(fb?.body ?? "{}")).toEqual({
      timeMin: "2026-10-11T12:00:00.000Z",
      timeMax: "2026-11-10T12:00:00.000Z",
      items: [{ id: "primary" }],
    });

    const replaces = marked("calendar_busy_sync:replace");
    expect(replaces).toHaveLength(1);
    const text = replaces[0]?.text ?? "";
    // delete + insert + the synced marker are one statement (atomic replace)
    expect(text).toContain("delete from public.external_busy_blocks x");
    expect(text).toContain("insert into public.external_busy_blocks");
    // ...whose FIRST step is the locking update: a disconnect or reconnect
    // that commits meanwhile is re-checked by Postgres and wins
    expect(text.indexOf("with conn as (")).toBeLessThan(text.indexOf("own as ("));
    // the read answers every request made before THIS run's claim: a
    // notification that lands during the read stays due (requested > synced)
    expect(text).toMatch(
      /with conn as \(\s*update public\.adapter_connections a\s*set busy_synced_at = \s*::text::timestamptz,/,
    );
    // ...and what it covered: the far end of the horizon is known to be read
    expect(text).toMatch(/busy_synced_until = \s*::timestamptz,/);
    expect(replaces[0]?.values).toContain("2026-11-10T12:00:00.000Z");
    // a good read resets the read-failure bookkeeping (backoff, alert window)
    expect(text).toContain("last_error = null,");
    expect(text).toContain("busy_sync_failing_since = null,");
    expect(text).toContain("busy_sync_failures = 0");
    expect(replaces[0]?.values.filter((v) => v === CLAIMED_AT).length).toBeGreaterThanOrEqual(2);
    // only while still connected and still this run's claim
    expect(text).toContain("a.status = 'connected'");
    // bound as text, then cast: a timestamptz bind would lose the microseconds
    expect(text).toContain("a.busy_sync_attempted_at = ");
    expect(text).toMatch(/a\.busy_sync_attempted_at = \s*::text::timestamptz/);
    expect(replaces[0]?.values).toContain(CLAIMED_AT);
    expect(text).toContain("using conn");
    // never another tenant's resource
    expect(text).toContain("rs.tenant_id =");
    // Heyloo's own Google-pushed bookings are taken out of the connection calendar
    expect(text).toContain("public.adapter_sync_state");
    expect(text).toContain("tstzmultirange(i.busy) - (select mr from own)");
    expect(replacePayload(replaces[0])).toEqual({
      blocks: [
        {
          calendar_id: "primary",
          resource_id: null,
          subtract_own: true,
          starts: "2026-10-12T14:00:00.000Z",
          ends: "2026-10-12T15:00:00.000Z",
        },
      ],
    });
    expect(replaces[0]?.values).toContain("conn-1");
    expect(replaces[0]?.values).toContain(T1);
  });

  it("an empty calendar still replaces (old blocks removed, none added)", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection()),
      "calendar_busy_sync:replace": [{ synced: true, removed: 2, added: 0 }],
    });
    const result = await runCalendarBusySync(sql, deps(googleFetch({}).fetchImpl));
    expect(result.synced).toBe(1);
    expect(replacePayload(marked("calendar_busy_sync:replace")[0])).toEqual({ blocks: [] });
  });

  it("chunks a 60-day horizon (+ 8 days slack) into <= 30-day requests (in parallel) and merges them", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ horizon_days: 59 })),
      "calendar_busy_sync:replace": [{ synced: true, removed: 0, added: 2 }],
    });
    const google = googleFetch({
      freeBusy: (req) =>
        Response.json({
          calendars: {
            primary: { busy: [{ start: req.timeMin, end: req.timeMin.replace("T12", "T13") }] },
          },
        }),
    });
    await runCalendarBusySync(sql, deps(google.fetchImpl));
    const windows = google.freeBusyCalls().map((c) => JSON.parse(c.body));
    expect(windows.map((w) => [w.timeMin, w.timeMax])).toEqual([
      ["2026-10-11T12:00:00.000Z", "2026-11-10T12:00:00.000Z"],
      ["2026-11-10T12:00:00.000Z", "2026-12-10T12:00:00.000Z"],
      ["2026-12-10T12:00:00.000Z", "2026-12-18T12:00:00.000Z"],
    ]);
    expect(replacePayload(marked("calendar_busy_sync:replace")[0]).blocks).toHaveLength(3);
  });

  it("reads a resource-mapped calendar too; its busy times block only that resource", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(
        connection({ resource_calendars: [{ resource_id: R2, calendar_id: "bo@example.com" }] }),
      ),
      "calendar_busy_sync:replace": [{ synced: true, removed: 0, added: 1 }],
    });
    const google = googleFetch({
      freeBusy: () =>
        Response.json({
          calendars: {
            primary: { busy: [] },
            "bo@example.com": {
              busy: [{ start: "2026-10-12T16:00:00Z", end: "2026-10-12T17:00:00Z" }],
            },
          },
        }),
    });
    await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(JSON.parse(google.freeBusyCalls()[0]?.body ?? "{}").items).toEqual([
      { id: "primary" },
      { id: "bo@example.com" },
    ]);
    expect(replacePayload(marked("calendar_busy_sync:replace")[0]).blocks).toEqual([
      {
        calendar_id: "bo@example.com",
        resource_id: R2,
        subtract_own: false,
        starts: "2026-10-12T16:00:00.000Z",
        ends: "2026-10-12T17:00:00.000Z",
      },
    ]);
  });

  it("a connection disconnected or reconnected mid-read is superseded, not synced", async () => {
    const { sql } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection()),
      "calendar_busy_sync:replace": [{ synced: false, removed: 0, added: 0 }],
    });
    const result = await runCalendarBusySync(sql, deps(googleFetch({}).fetchImpl));
    expect(result).toMatchObject({ synced: 0, failed: 0, superseded: 1 });
  });

  it("reads a 365-day booking horizon in full, plus the slack (13 chunks of <= 30 days)", async () => {
    const { sql } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ horizon_days: 365 })),
      "calendar_busy_sync:replace": [{ synced: true, removed: 0, added: 0 }],
    });
    const google = googleFetch({});
    await runCalendarBusySync(sql, deps(google.fetchImpl));
    const windows = google.freeBusyCalls().map((c) => JSON.parse(c.body));
    expect(windows).toHaveLength(13);
    expect(windows[0]?.timeMin).toBe("2026-10-11T12:00:00.000Z");
    expect(windows[12]?.timeMax).toBe(
      new Date(Date.parse("2026-10-11T12:00:00.000Z") + 374 * 86_400_000).toISOString(),
    );
  });

  it("a quiet calendar still covers the whole horizon until its next read (renewal ~6 days on, at most 7)", async () => {
    for (const horizon of [null, 21, 30, 90, 365]) {
      const { sql } = makeSql({
        "calendar_busy_sync:claim": claimQueue(connection({ horizon_days: horizon })),
        "calendar_busy_sync:replace": [{ synced: true, removed: 0, added: 0 }],
      });
      const google = googleFetch({});
      await runCalendarBusySync(sql, deps(google.fetchImpl));
      const windows = google.freeBusyCalls().map((c) => JSON.parse(c.body));
      const coveredUntil = Date.parse(windows.at(-1)?.timeMax ?? "");
      // the channel lives 7 days; renewal (and its read) comes a day earlier
      for (const daysLater of [6, 7]) {
        const later = NOW + daysLater * 86_400_000;
        const horizonEnd = later + syncHorizonDays(horizon) * 86_400_000;
        expect(coveredUntil).toBeGreaterThanOrEqual(horizonEnd);
      }
      // and the claim's coverage check (window short of now + horizon) only
      // fires a day after even the latest renewal read would have come
      const firesAt = coveredUntil - syncHorizonDays(horizon) * 86_400_000;
      expect(firesAt - NOW).toBeGreaterThanOrEqual(7 * 86_400_000);
    }
  });
});

describe("runCalendarBusySync — throughput", () => {
  it("60 due connections are all claimed and synced in ONE run, at most 10 at a time", async () => {
    const due = Array.from({ length: 60 }, (_v, i) =>
      connection({ id: `conn-${i}`, tenant_id: `tenant-${i}` }),
    );
    let inFlight = 0;
    let peak = 0;
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(...due),
      "calendar_busy_sync:replace": async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return [{ synced: true, removed: 0, added: 0 }];
      },
    });
    const result = await runCalendarBusySync(sql, deps(googleFetch({}).fetchImpl));
    expect(result).toMatchObject({ claimed: 60, synced: 60, failed: 0 });
    expect(marked("calendar_busy_sync:replace")).toHaveLength(60);
    expect(peak).toBeLessThanOrEqual(CALENDAR_SYNC_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });

  it("lanes stop claiming once the run is past its claim budget", async () => {
    let clock = NOW;
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(
        ...Array.from({ length: 30 }, (_v, i) => connection({ id: `conn-${i}` })),
      ),
      "calendar_busy_sync:replace": () => {
        clock += CALENDAR_SYNC_CLAIM_BUDGET_MS; // one slow sync uses the budget up
        return [{ synced: true, removed: 0, added: 0 }];
      },
    });
    const result = await runCalendarBusySync(
      sql,
      deps(googleFetch({}).fetchImpl, { now: () => clock, concurrency: 2 }),
    );
    expect(result.claimed).toBe(2);
    expect(marked("calendar_busy_sync:claim")).toHaveLength(2);
  });
});

describe("runCalendarBusySync — token refresh", () => {
  it("refreshes a token expiring within 10 minutes, persists it re-encrypted, and reads with it", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(
        connection({ expires_at: new Date(NOW + 9 * 60_000).toISOString() }),
      ),
      "calendar_busy_sync:replace": [{ synced: true, removed: 0, added: 0 }],
    });
    const google = googleFetch({});
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(result.synced).toBe(1);
    expect(new URLSearchParams(google.tokenCalls()[0]?.body).get("refresh_token")).toBe(
      "refresh-1",
    );
    const persisted = marked("calendar_busy_sync:token")[0];
    expect(persisted?.values).not.toContain("access-2");
    const encrypted = persisted?.values.find(
      (v) => typeof v === "string" && v.startsWith("v1:"),
    ) as string;
    expect(await decryptSecret(encrypted, KEY)).toBe("access-2");
    expect(persisted?.values).toContain(new Date(NOW + 3_600_000).toISOString());
    expect(google.freeBusyCalls()[0]?.authorization).toBe("Bearer access-2");
  });

  it("an expires_at with no value is refreshed too (unknown expiry)", async () => {
    const { sql } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ expires_at: null })),
      "calendar_busy_sync:replace": [{ synced: true, removed: 0, added: 0 }],
    });
    const google = googleFetch({});
    await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(google.tokenCalls()).toHaveLength(1);
  });

  it("a refresh that rotates the refresh token stores the new one, encrypted", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ expires_at: null })),
      "calendar_busy_sync:replace": [{ synced: true, removed: 0, added: 0 }],
    });
    const google = googleFetch({
      token: () =>
        Response.json({ access_token: "access-2", expires_in: 3600, refresh_token: "refresh-2" }),
    });
    await runCalendarBusySync(sql, deps(google.fetchImpl));
    const values = marked("calendar_busy_sync:token")[0]?.values ?? [];
    const decrypted = await Promise.all(
      values
        .filter((v): v is string => typeof v === "string" && v.startsWith("v1:"))
        .map((v) => decryptSecret(v, KEY)),
    );
    expect(decrypted).toEqual(["access-2", "refresh-2"]);
  });

  it("a token refreshed for a connection this run no longer holds is not stored, and nothing is read", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ expires_at: null })),
      // the owner reconnected meanwhile (claim reset) or it was disconnected
      "calendar_busy_sync:token": [],
    });
    const google = googleFetch({});
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(result).toMatchObject({ superseded: 1, synced: 0, failed: 0 });
    const token = marked("calendar_busy_sync:token")[0];
    expect(token?.text).toContain("and busy_sync_attempted_at =");
    expect(token?.values).toContain(CLAIMED_AT);
    expect(google.freeBusyCalls()).toHaveLength(0);
    expect(marked("calendar_busy_sync:replace")).toHaveLength(0);
  });
});

describe("runCalendarBusySync — failures", () => {
  it("invalid_grant: marks the connection needing reconnect and keeps fresh blocks; the alert step tells the owner", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(
        connection({ expires_at: new Date(NOW - 1000).toISOString() }),
      ),
      "calendar_busy_sync:auth_failure": [{ marked: 1, cleared: 0 }],
      ...ALERT_ROUTES,
    });
    const google = googleFetch({
      token: () => Response.json({ error: "invalid_grant" }, { status: 400 }),
    });
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(result).toMatchObject({ claimed: 1, needs_reconnect: 1, synced: 0 });
    const auth = marked("calendar_busy_sync:auth_failure")[0];
    expect(auth?.text).toContain("set status = 'disconnected', disconnected_at = now()");
    expect(auth?.text).toContain("and status = 'connected'");
    // only while this run still holds the connection (a reconnect resets the claim)
    expect(auth?.text).toContain("and busy_sync_attempted_at =");
    expect(auth?.values).toContain(CLAIMED_AT);
    // blocks are only dropped once already stale (24 h)
    expect(auth?.text).toContain("m.busy_synced_at < now() - make_interval(hours =>");
    expect(auth?.values).toContain(24);
    expect(auth?.values).toContain("google_calendar refresh_token invalid/revoked");
    // its push channel is forgotten in the same statement
    expect(auth?.text).toContain(
      "watch_channel_id = null, watch_resource_id = null, watch_token_hash = null",
    );
    // the stored access token had expired: no channels.stop attempt with it
    expect(google.stopCalls()).toHaveLength(0);
    // one alert path for every break (alertBrokenConnections), not here
    expect(marked("insert into public.messages_outbound")).toHaveLength(0);
    expect(google.freeBusyCalls()).toHaveLength(0);
    expect(marked("calendar_busy_sync:replace")).toHaveLength(0);
  });

  it("a 401 on the freeBusy read is an auth failure too", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection()),
      "calendar_busy_sync:auth_failure": [{ marked: 1, cleared: 0 }],
    });
    const google = googleFetch({ freeBusy: () => Response.json({}, { status: 401 }) });
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(result.needs_reconnect).toBe(1);
    expect(marked("calendar_busy_sync:auth_failure")[0]?.values).toContain(
      "google_calendar 401 on busy-time read",
    );
  });

  it("no refresh token and an expired access token: needs reconnect, without calling Google", async () => {
    const { sql } = makeSql({
      "calendar_busy_sync:claim": claimQueue(
        connection({ refresh_token: null, expires_at: new Date(NOW - 1000).toISOString() }),
      ),
      "calendar_busy_sync:auth_failure": [{ marked: 1, cleared: 0 }],
    });
    const google = googleFetch({});
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(result.needs_reconnect).toBe(1);
    expect(google.calls).toHaveLength(0);
  });

  it.each([
    [
      "per-calendar errors[] (never read as free)",
      () =>
        Response.json({
          calendars: { primary: { busy: [], errors: [{ domain: "global", reason: "notFound" }] } },
        }),
      "calendar_error",
    ],
    ["a 503", () => Response.json({}, { status: 503 }), "server"],
    [
      "a usage limit",
      () =>
        Response.json(
          { error: { errors: [{ domain: "usageLimits", reason: "rateLimitExceeded" }] } },
          { status: 403 },
        ),
      "rate_limited",
    ],
    ["an unexpected body", () => Response.json({ nope: true }), "invalid_response"],
  ])(
    "%s keeps the existing blocks and records last_error (retry next window)",
    async (_l, fb, failure) => {
      const { sql, marked } = makeSql({ "calendar_busy_sync:claim": claimQueue(connection()) });
      const result = await runCalendarBusySync(sql, deps(googleFetch({ freeBusy: fb }).fetchImpl));
      expect(result).toMatchObject({ failed: 1, synced: 0, needs_reconnect: 0 });
      expect(marked("calendar_busy_sync:replace")).toHaveLength(0);
      expect(marked("calendar_busy_sync:auth_failure")).toHaveLength(0);
      const transient = marked("calendar_busy_sync:transient")[0];
      expect(transient?.text).toContain("set last_error =");
      expect(transient?.text).toContain("status = 'connected'");
      // the failure window starts at the first failure and is kept after
      expect(transient?.text).toContain(
        "busy_sync_failing_since = coalesce(busy_sync_failing_since, now())",
      );
      // one more consecutive failure: the claim's backoff grows (1, 5, 15, 60 min)
      expect(transient?.text).toContain("busy_sync_failures = busy_sync_failures + 1");
      expect(String(transient?.values[0]).startsWith(CALENDAR_SYNC_ERROR_PREFIX)).toBe(true);
      expect(transient?.text).toContain("busy_sync_attempted_at =");
      expect(transient?.values).toContain(CLAIMED_AT);
      expect(String(transient?.values[0])).toContain(failure);
    },
  );

  it("one failing chunk fails the whole read (no partial replace)", async () => {
    let n = 0;
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ horizon_days: 59 })),
    });
    const google = googleFetch({
      freeBusy: (req) => {
        n += 1;
        return n === 2
          ? Response.json({}, { status: 500 })
          : Response.json({
              calendars: Object.fromEntries(req.items.map((i) => [i.id, { busy: [] }])),
            });
      },
    });
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(result.failed).toBe(1);
    expect(marked("calendar_busy_sync:replace")).toHaveLength(0);
  });

  it("Google refusing OUR client (invalid_client) never marks the tenant's connection broken", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ expires_at: null })),
    });
    const google = googleFetch({
      token: () => Response.json({ error: "invalid_client" }, { status: 401 }),
    });
    const d = deps(google.fetchImpl);
    const result = await runCalendarBusySync(sql, d);
    expect(result.failed).toBe(1);
    expect(marked("calendar_busy_sync:auth_failure")).toHaveLength(0);
    expect(marked("calendar_busy_sync:transient")).toHaveLength(1);
    expect(d.logger.error).toHaveBeenCalledWith(
      "calendar_busy_sync_client_config",
      expect.anything(),
    );
  });

  it("a request that hangs is aborted at the per-request timeout and treated as transient", async () => {
    const { sql, marked } = makeSql({ "calendar_busy_sync:claim": claimQueue(connection()) });
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const started = Date.now();
    const result = await runCalendarBusySync(sql, deps(hanging, { requestTimeoutMs: 25 }));
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.failed).toBe(1);
    expect(String(marked("calendar_busy_sync:transient")[0]?.values[0])).toContain("timed out");
  });

  it("a stored token that cannot be decrypted is our problem: failed + logged, nothing sent", async () => {
    const { sql } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ access_token: "v1:bad:bad" })),
    });
    const google = googleFetch({});
    const d = deps(google.fetchImpl);
    const result = await runCalendarBusySync(sql, d);
    expect(result.failed).toBe(1);
    expect(google.calls).toHaveLength(0);
    expect(d.logger.error).toHaveBeenCalledWith(
      "calendar_busy_sync_decrypt_failed",
      expect.anything(),
    );
  });

  it("one connection's unexpected error never affects another's sync", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(
        connection({ id: "conn-bad", tenant_id: "tenant-bad" }),
        connection({ id: "conn-good", tenant_id: "tenant-good" }),
      ),
      "calendar_busy_sync:replace": (values) =>
        values.includes("conn-bad")
          ? Promise.reject(new Error("deadlock"))
          : [{ synced: true, removed: 0, added: 0 }],
    });
    const result = await runCalendarBusySync(sql, deps(googleFetch({}).fetchImpl));
    expect(result).toMatchObject({ claimed: 2, synced: 1, failed: 1 });
    expect(marked("calendar_busy_sync:transient")[0]?.values).toContain("conn-bad");
  });

  it("past the leg's start deadline (slow refresh), the claim is released for the next tick", async () => {
    let clock = NOW;
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ expires_at: null })),
    });
    const google = googleFetch({
      token: () => {
        clock += 8_000;
        return Response.json({ access_token: "access-2", expires_in: 3600 });
      },
    });
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl, { now: () => clock }));
    expect(result).toMatchObject({ deferred: 1, synced: 0 });
    const release = marked("calendar_busy_sync:release")[0];
    expect(release?.text).toContain("set busy_sync_attempted_at = null");
    expect(release?.text).toContain("and busy_sync_attempted_at =");
    expect(release?.values).toContain(CLAIMED_AT);
    expect(google.freeBusyCalls()).toHaveLength(0);
  });
});

describe("runCalendarBusySync — owner alerts (alertBrokenConnections)", () => {
  const ALERT_CLAIM = "calendar_busy_sync:alert_claim";

  function alertClaim(overrides: Record<string, unknown> = {}) {
    return {
      id: "conn-1",
      tenant_id: T1,
      status: "disconnected",
      previous_alerted_at: null,
      claimed_alerted_at: "2026-10-11 12:00:30.654321+00",
      ...overrides,
    };
  }

  it("claims each due connection once, whoever broke it, and queues one alert per claim", async () => {
    const { sql, marked } = makeSql({
      [ALERT_CLAIM]: [
        alertClaim(),
        alertClaim({ id: "conn-2", tenant_id: "tenant-2", status: "connected" }),
      ],
      ...ALERT_ROUTES,
    });
    const result = await runCalendarBusySync(sql, deps(googleFetch({}).fetchImpl));
    expect(result.owner_alerts).toBe(2);
    const claim = marked(ALERT_CLAIM)[0];
    const text = claim?.text ?? "";
    expect(text).toContain("for update skip locked");
    expect(text).toContain("set owner_alerted_at = now()");
    // a disconnect by ANY worker (sync or booking push), never the owner's own
    expect(text).toContain("c.status = 'disconnected' and c.disconnected_at is not null");
    expect(text).toContain("c.last_error is distinct from");
    expect(claim?.values).toContain(TENANT_DISCONNECT_REASON);
    expect(text).toContain("c.owner_alerted_at < c.disconnected_at");
    // reads failing for hours on a still-connected calendar
    expect(text).toContain("c.busy_sync_failing_since < now() - make_interval(hours =>");
    expect(claim?.values).toContain(CALENDAR_READ_FAILING_ALERT_HOURS);
    expect(text).toContain("c.owner_alerted_at < c.busy_sync_failing_since");
    const inserts = marked("insert into public.messages_outbound");
    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.values).toEqual(expect.arrayContaining([T1, "owner_calendar_disconnected"]));
    const payloads = inserts.map((c) =>
      c.values.find((v) => typeof v === "object" && v !== null && "provider_name" in v),
    );
    expect(payloads).toEqual([
      { provider_name: "Google Calendar", reason: "disconnected" },
      { provider_name: "Google Calendar", reason: "read_failing" },
    ]);
  });

  it("an alert that cannot be queued is logged, never thrown, and its claim is given back", async () => {
    const { sql, marked } = makeSql({
      [ALERT_CLAIM]: [alertClaim({ previous_alerted_at: "2026-10-01 08:00:00.5+00" })],
      "public.agent_configs ac": () => Promise.reject(new Error("db down")),
    });
    const d = deps(googleFetch({}).fetchImpl);
    const result = await runCalendarBusySync(sql, d);
    expect(result.owner_alerts).toBe(0);
    expect(d.logger.error).toHaveBeenCalledWith(
      "calendar_busy_sync_alert_failed",
      expect.objectContaining({ tenant_id: T1 }),
    );
    const release = marked("calendar_busy_sync:alert_release")[0];
    expect(release?.text).toContain("set owner_alerted_at =");
    // only if no newer claim replaced it since
    expect(release?.text).toContain("and owner_alerted_at =");
    expect(release?.values).toEqual(
      expect.arrayContaining(["2026-10-01 08:00:00.5+00", "2026-10-11 12:00:30.654321+00"]),
    );
  });

  it("a failing alert claim is logged and the sync still runs", async () => {
    const { sql, marked } = makeSql({
      [ALERT_CLAIM]: () => Promise.reject(new Error("lock timeout")),
      "calendar_busy_sync:claim": claimQueue(connection()),
      "calendar_busy_sync:replace": [{ synced: true, removed: 0, added: 0 }],
    });
    const d = deps(googleFetch({}).fetchImpl);
    const result = await runCalendarBusySync(sql, d);
    expect(result).toMatchObject({ owner_alerts: 0, synced: 1 });
    expect(d.logger.error).toHaveBeenCalledWith(
      "calendar_busy_sync_alert_claim_failed",
      expect.anything(),
    );
    expect(marked("calendar_busy_sync:replace")).toHaveLength(1);
  });

  it("an owner with no reachable destination is not counted (and not retried)", async () => {
    const { sql, marked } = makeSql({
      [ALERT_CLAIM]: [alertClaim()],
      "public.agent_configs ac": [{ transfer_number: null, delivery: null, owner_email: null }],
    });
    const result = await runCalendarBusySync(sql, deps(googleFetch({}).fetchImpl));
    expect(result.owner_alerts).toBe(0);
    expect(marked("calendar_busy_sync:alert_release")).toHaveLength(0);
  });
});

describe("runCalendarBusySync — push channels (CAL-1b)", () => {
  it("registers the first channel (random token, only its hash stored), then reads once", async () => {
    const { sql, marked, calls } = makeSql({
      "calendar_busy_sync:claim": claimQueue(
        connection({
          read_due: false,
          channel_due: true,
          channel_live: false,
          watch_channel_id: null,
          watch_resource_id: null,
        }),
      ),
      "calendar_busy_sync:watch_store": [{ id: "conn-1" }],
      "calendar_busy_sync:replace": [{ synced: true, removed: 0, added: 0 }],
    });
    const google = googleFetch({});
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(result).toMatchObject({
      claimed: 1,
      synced: 1,
      channels_registered: 1,
      channels_failed: 0,
      channels_stopped: 0,
    });

    const [watch] = google.watchCalls();
    expect(watch?.url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events/watch",
    );
    expect(watch?.authorization).toBe("Bearer access-1");
    const req = JSON.parse(watch?.body ?? "{}") as WatchRequest;
    expect(req.type).toBe("web_hook");
    expect(req.address).toBe(ADDRESS);
    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.token.length).toBeGreaterThanOrEqual(43);
    expect(req.params).toEqual({ ttl: String(CALENDAR_WATCH_TTL_SECONDS) });

    const store = marked("calendar_busy_sync:watch_store")[0];
    expect(store?.values).toContain(req.id);
    expect(store?.values).toContain("res-new");
    expect(store?.values).toContain(await sha256Hex(req.token));
    // the plaintext token is never written anywhere
    for (const c of calls) expect(c.values).not.toContain(req.token);
    expect(store?.values).toContain(new Date(NOW + 7 * 86_400_000).toISOString());
    // guarded on this run's claim, still connected; requests a read as of the claim
    expect(store?.text).toContain("and busy_sync_attempted_at =");
    expect(store?.text).toContain("status = 'connected'");
    expect(store?.text).toContain("busy_sync_requested_at =");
    expect(store?.text).toContain("greatest(busy_sync_requested_at,");
    expect(store?.values.filter((v) => v === CLAIMED_AT)).toHaveLength(2);
    // the channel backoff is cleared, and the next registration held off an
    // hour (a short Google expiry never means a watch call every minute)
    expect(store?.text).toContain("watch_failures = 0,");
    expect(store?.text).toMatch(/watch_retry_at = now\(\) \+ make_interval\(mins => {2}\)/);
    expect(store?.values).toContain(CALENDAR_WATCH_RENEW_MIN_INTERVAL_MINUTES);

    // the read comes after the channel is active (nothing changed in between is lost)
    const order = google.calls.map((c) => c.url.split("/").pop());
    expect(order).toEqual(["watch", "freeBusy"]);
    expect(marked("calendar_busy_sync:replace")).toHaveLength(1);
  });

  it("renewal: a new channel (new id) is stored, the OLD one is stopped, and the calendar read once", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ read_due: false, channel_due: true })),
      "calendar_busy_sync:watch_store": [{ id: "conn-1" }],
      "calendar_busy_sync:replace": [{ synced: true, removed: 0, added: 0 }],
    });
    const google = googleFetch({});
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(result).toMatchObject({ synced: 1, channels_registered: 1, channels_stopped: 1 });
    const newId = (JSON.parse(google.watchCalls()[0]?.body ?? "{}") as WatchRequest).id;
    expect(newId).not.toBe("chan-old");
    const [stop] = google.stopCalls();
    expect(JSON.parse(stop?.body ?? "{}")).toEqual({ id: "chan-old", resourceId: "res-old" });
    // stopped only after the new channel was stored
    const watchStoreIndex = google.calls.findIndex((c) => c.url.endsWith("/events/watch"));
    const stopIndex = google.calls.findIndex((c) => c.url.endsWith("/channels/stop"));
    expect(stopIndex).toBeGreaterThan(watchStoreIndex);
    expect(marked("calendar_busy_sync:watch_store")).toHaveLength(1);
    expect(google.freeBusyCalls()).toHaveLength(1);
  });

  it("renewal: an old channel that cannot be stopped never fails the sync (it runs out by itself)", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ read_due: false, channel_due: true })),
      "calendar_busy_sync:watch_store": [{ id: "conn-1" }],
      "calendar_busy_sync:replace": [{ synced: true, removed: 0, added: 0 }],
    });
    const d = deps(googleFetch({ stop: () => Response.json({}, { status: 500 }) }).fetchImpl);
    const result = await runCalendarBusySync(sql, d);
    expect(result).toMatchObject({
      synced: 1,
      failed: 0,
      channels_registered: 1,
      channels_stopped: 0,
    });
    expect(marked("calendar_busy_sync:transient")).toHaveLength(0);
    expect(d.logger.warn).toHaveBeenCalledWith(
      "calendar_watch_stop_failed",
      expect.objectContaining({ channel_id: "chan-old" }),
    );
  });

  it("a channel answer with no expiration is stored as now + the requested 7 days", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ read_due: false, channel_due: true })),
      "calendar_busy_sync:watch_store": [{ id: "conn-1" }],
      "calendar_busy_sync:replace": [{ synced: true, removed: 0, added: 0 }],
    });
    const google = googleFetch({
      watch: (req) => Response.json({ id: req.id, resourceId: "res-new" }),
    });
    await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(marked("calendar_busy_sync:watch_store")[0]?.values).toContain(
      new Date(NOW + CALENDAR_WATCH_TTL_SECONDS * 1000).toISOString(),
    );
  });

  it("a failed renewal while the old channel still lives: the requested read is served undelayed, and only the CHANNEL backoff grows", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ read_due: true, channel_due: true })),
      "calendar_busy_sync:replace": [{ synced: true, removed: 0, added: 0 }],
    });
    const google = googleFetch({ watch: () => Response.json({}, { status: 503 }) });
    const d = deps(google.fetchImpl);
    const result = await runCalendarBusySync(sql, d);
    expect(result).toMatchObject({
      synced: 1,
      failed: 0,
      channels_registered: 0,
      channels_failed: 1,
    });
    expect(marked("calendar_busy_sync:watch_store")).toHaveLength(0);
    expect(google.stopCalls()).toHaveLength(0);
    expect(google.freeBusyCalls()).toHaveLength(1);
    // the read is stored and resets the READ bookkeeping as usual...
    expect(marked("calendar_busy_sync:replace")[0]?.text).toContain("busy_sync_failures = 0");
    // ...the read bookkeeping (last_error, failing-since, read backoff) is
    // never touched by the channel: no "having trouble reading" note, no
    // read_failing alert, no delay for the next notification-driven read
    expect(marked("calendar_busy_sync:transient")).toHaveLength(0);
    const failure = marked("calendar_busy_sync:watch_failure");
    expect(failure).toHaveLength(1);
    const text = failure[0]?.text ?? "";
    expect(text).toContain("set watch_failures = watch_failures + 1");
    expect(text).toContain(
      `(array[${CALENDAR_SYNC_BACKOFF_MINUTES.join(", ")}])[least(watch_failures + 1, ${CALENDAR_SYNC_BACKOFF_MINUTES.length})]`,
    );
    expect(text).not.toContain("last_error");
    expect(text).not.toContain("busy_sync_failures");
    expect(text).toContain("and busy_sync_attempted_at =");
    expect(failure[0]?.values).toContain(CLAIMED_AT);
    expect(d.logger.warn).toHaveBeenCalledWith(
      "calendar_watch_register_failed",
      expect.objectContaining({ failure: "server", status: 503, channel_live: true }),
    );
  });

  it("a failed renewal with no read due while the old channel lives: no read, the claim is kept (the retry waits for watch_retry_at)", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ read_due: false, channel_due: true })),
    });
    const google = googleFetch({ watch: () => Response.json({}, { status: 429 }) });
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(result).toMatchObject({
      claimed: 1,
      synced: 0,
      failed: 0,
      deferred: 0,
      channels_failed: 1,
    });
    expect(google.freeBusyCalls()).toHaveLength(0);
    expect(marked("calendar_busy_sync:watch_failure")).toHaveLength(1);
    expect(marked("calendar_busy_sync:transient")).toHaveLength(0);
    expect(marked("calendar_busy_sync:release")).toHaveLength(0);
  });

  it.each([
    ["no channel yet", { watch_channel_id: null, watch_resource_id: null, channel_live: false }],
    ["an expired or forced channel", { channel_live: false }],
  ])(
    "a failed registration with %s still reads the calendar (nothing else would ever ask for a read)",
    async (_label, overrides) => {
      const { sql, marked } = makeSql({
        "calendar_busy_sync:claim": claimQueue(
          connection({ read_due: false, channel_due: true, ...overrides }),
        ),
        "calendar_busy_sync:replace": [{ synced: true, removed: 0, added: 0 }],
      });
      const google = googleFetch({
        watch: () => Response.json({ error: { errors: [{ reason: "invalid" }] } }, { status: 400 }),
      });
      const d = deps(google.fetchImpl);
      const result = await runCalendarBusySync(sql, d);
      expect(result).toMatchObject({ synced: 1, failed: 0, channels_failed: 1 });
      expect(google.freeBusyCalls()).toHaveLength(1);
      expect(marked("calendar_busy_sync:replace")).toHaveLength(1);
      expect(marked("calendar_busy_sync:watch_failure")).toHaveLength(1);
      // not fixed by a retry on its own (our address / config): an error log
      expect(d.logger.error).toHaveBeenCalledWith(
        "calendar_watch_register_failed",
        expect.objectContaining({ failure: "request_rejected", channel_live: false }),
      );
    },
  );

  it.each([
    ["a 401", () => Response.json({}, { status: 401 })],
    [
      "a non-usage 403 (e.g. the webhook address refused)",
      () =>
        Response.json(
          { error: { errors: [{ domain: "push", reason: "webhookUrlUnauthorized" }] } },
          { status: 403 },
        ),
    ],
  ])(
    "%s on events.watch never disconnects on its own: the read decides, and a good read keeps the connection",
    async (_label, watch) => {
      const { sql, marked } = makeSql({
        "calendar_busy_sync:claim": claimQueue(connection({ read_due: false, channel_due: true })),
        "calendar_busy_sync:replace": [{ synced: true, removed: 0, added: 0 }],
      });
      const google = googleFetch({ watch });
      const result = await runCalendarBusySync(sql, deps(google.fetchImpl));
      expect(result).toMatchObject({ synced: 1, needs_reconnect: 0, channels_failed: 1 });
      // read even though the old channel lives: the refused token is tested
      expect(google.freeBusyCalls()).toHaveLength(1);
      expect(marked("calendar_busy_sync:auth_failure")).toHaveLength(0);
      expect(marked("calendar_busy_sync:watch_failure")).toHaveLength(1);
    },
  );

  it("a 401 on events.watch AND on the read: needs reconnect (the read's verdict), channel cleared", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ read_due: true, channel_due: true })),
      "calendar_busy_sync:auth_failure": [{ marked: 1, cleared: 0 }],
    });
    const google = googleFetch({
      watch: () => Response.json({}, { status: 401 }),
      freeBusy: () => Response.json({}, { status: 401 }),
    });
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(result).toMatchObject({ needs_reconnect: 1, synced: 0, channels_failed: 1 });
    const auth = marked("calendar_busy_sync:auth_failure")[0];
    expect(auth?.values).toContain("google_calendar 401 on busy-time read");
    expect(auth?.text).toContain("watch_channel_id = null");
    expect(marked("calendar_busy_sync:replace")).toHaveLength(0);
    // the token Google just refused is not used again for channels.stop
    expect(google.stopCalls()).toHaveLength(0);
  });

  it("a failed registration and a failed read: each counted on its own side", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ read_due: true, channel_due: true })),
    });
    const google = googleFetch({
      watch: () => Response.json({}, { status: 503 }),
      freeBusy: () => Response.json({}, { status: 503 }),
    });
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(result).toMatchObject({ failed: 1, synced: 0, channels_failed: 1 });
    expect(marked("calendar_busy_sync:watch_failure")).toHaveLength(1);
    const transient = marked("calendar_busy_sync:transient");
    expect(transient).toHaveLength(1);
    expect(String(transient[0]?.values[0])).toBe(
      `${CALENDAR_SYNC_ERROR_PREFIX}server (freeBusy 503)`,
    );
  });

  it("a channel registered by a run that lost its claim (reconnect/disconnect) is stopped, nothing read", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ read_due: true, channel_due: true })),
      "calendar_busy_sync:watch_store": [],
    });
    const google = googleFetch({});
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(result).toMatchObject({ superseded: 1, synced: 0, channels_registered: 0 });
    const newId = (JSON.parse(google.watchCalls()[0]?.body ?? "{}") as WatchRequest).id;
    const stops = google.stopCalls().map((c) => JSON.parse(c.body));
    expect(stops).toEqual([{ id: newId, resourceId: "res-new" }]);
    expect(google.freeBusyCalls()).toHaveLength(0);
    expect(marked("calendar_busy_sync:replace")).toHaveLength(0);
  });

  it("past the start deadline before the watch call: claim handed back, no Google call", async () => {
    let clock = NOW;
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(
        connection({ read_due: false, channel_due: true, expires_at: null }),
      ),
    });
    const google = googleFetch({
      token: () => {
        clock += 8_000;
        return Response.json({ access_token: "access-2", expires_in: 3600 });
      },
    });
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl, { now: () => clock }));
    expect(result).toMatchObject({ deferred: 1, channels_registered: 0 });
    expect(google.watchCalls()).toHaveLength(0);
    expect(marked("calendar_busy_sync:release")).toHaveLength(1);
  });

  it("past the deadline after registering: the read waits for the next tick (request stays due), old channel still stopped", async () => {
    let clock = NOW;
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection({ read_due: false, channel_due: true })),
      "calendar_busy_sync:watch_store": () => {
        clock += 8_000;
        return [{ id: "conn-1" }];
      },
    });
    const google = googleFetch({});
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl, { now: () => clock }));
    expect(result).toMatchObject({ deferred: 1, channels_registered: 1, channels_stopped: 1 });
    expect(google.freeBusyCalls()).toHaveLength(0);
    expect(marked("calendar_busy_sync:release")).toHaveLength(1);
    // the stored channel requested the read, so the next claim reads
    expect(marked("calendar_busy_sync:watch_store")[0]?.text).toContain("busy_sync_requested_at =");
  });

  it("invalid_grant while the stored access token is still good: the channel is stopped with it before disconnecting", async () => {
    const { sql, marked } = makeSql({
      "calendar_busy_sync:claim": claimQueue(
        // expires in 5 minutes: inside the refresh margin, still usable
        connection({ expires_at: new Date(NOW + 5 * 60_000).toISOString() }),
      ),
      "calendar_busy_sync:auth_failure": [{ marked: 1, cleared: 0 }],
    });
    const google = googleFetch({
      token: () => Response.json({ error: "invalid_grant" }, { status: 400 }),
    });
    const result = await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(result).toMatchObject({ needs_reconnect: 1, channels_stopped: 1 });
    const [stop] = google.stopCalls();
    expect(stop?.authorization).toBe("Bearer access-1");
    expect(JSON.parse(stop?.body ?? "{}")).toEqual({ id: "chan-old", resourceId: "res-old" });
    expect(marked("calendar_busy_sync:auth_failure")).toHaveLength(1);
  });

  it("a requested read on a healthy channel calls freeBusy only (no watch, no stop)", async () => {
    const { sql } = makeSql({
      "calendar_busy_sync:claim": claimQueue(connection()),
      "calendar_busy_sync:replace": [{ synced: true, removed: 0, added: 0 }],
    });
    const google = googleFetch({});
    await runCalendarBusySync(sql, deps(google.fetchImpl));
    expect(google.calls.map((c) => c.url.split("/").pop())).toEqual(["freeBusy"]);
  });
});
