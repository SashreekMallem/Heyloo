import { describe, expect, it } from "vitest";
import {
  exchangeGoogleAuthCode,
  freeBusyQuery,
  GOOGLE_CALENDAR_OAUTH_SCOPES,
  insertCalendarEvent,
  missingGoogleCalendarPermissions,
  parseGoogleCalendarNotification,
  parseGoogleTokenResponse,
  refreshGoogleAccessToken,
  stopWatchChannel,
  toGoogleEventId,
  watchCalendarEvents,
} from "./google-calendar.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("toGoogleEventId", () => {
  it("is deterministic and Google-legal", () => {
    const a = toGoogleEventId("call_1:slot_1");
    expect(a).toBe(toGoogleEventId("call_1:slot_1"));
    expect(a).toMatch(/^[a-v0-9]+$/);
  });
});

describe("Google Calendar REST calls", () => {
  it("insertCalendarEvent uses the deterministic event id for idempotency", async () => {
    let captured: any;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ id: captured.id });
    }) as any;
    const result = await insertCalendarEvent(fetchImpl, "token", {
      calendarId: "primary",
      idempotencyKey: "call_1:slot_1",
      summary: "Jane Doe",
      description: "desc",
      startAt: "2026-09-10T14:00:00Z",
      endAt: "2026-09-10T14:30:00Z",
    });
    expect(result.ok).toBe(true);
    expect(captured.id).toBe(toGoogleEventId("call_1:slot_1"));
  });
});

// ---------------------------------------------------------------------------
// CAL-1b: events.watch, channels.stop, notification headers
// ---------------------------------------------------------------------------

const WATCH_PARAMS = {
  calendarId: "primary",
  channelId: "8f8e0f8e-1b1c-4c1d-9e9f-0a0b0c0d0e0f",
  address: "https://ref.supabase.co/functions/v1/webhooks-pos/google_calendar",
  token: "tok_abc",
};

function recordingFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("watchCalendarEvents (CAL-1b)", () => {
  it("POSTs the documented web_hook channel to events/watch and reads the channel back", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({
        kind: "api#channel",
        id: WATCH_PARAMS.channelId,
        resourceId: "res_1",
        resourceUri: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        token: "tok_abc",
        expiration: "1792000000000",
      }),
    );
    const result = await watchCalendarEvents(fetchImpl, "access", {
      ...WATCH_PARAMS,
      ttlSeconds: 604800,
    });
    expect(result).toEqual({
      ok: true,
      channel: {
        channelId: WATCH_PARAMS.channelId,
        resourceId: "res_1",
        expiresAt: new Date(1792000000000).toISOString(),
      },
    });
    expect(calls[0]?.url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events/watch",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect((calls[0]?.init?.headers as Record<string, string> | undefined)?.["authorization"]).toBe(
      "Bearer access",
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      id: WATCH_PARAMS.channelId,
      type: "web_hook",
      address: WATCH_PARAMS.address,
      token: "tok_abc",
      params: { ttl: "604800" },
    });
  });

  it("accepts a numeric expiration and a missing one (null: caller assumes the ttl)", async () => {
    const numeric = await watchCalendarEvents(
      recordingFetch(() =>
        jsonResponse({ id: WATCH_PARAMS.channelId, resourceId: "r", expiration: 1792000000000 }),
      ).fetchImpl,
      "a",
      WATCH_PARAMS,
    );
    expect(numeric.ok && numeric.channel.expiresAt).toBe(new Date(1792000000000).toISOString());
    const missing = await watchCalendarEvents(
      recordingFetch(() => jsonResponse({ id: WATCH_PARAMS.channelId, resourceId: "r" })).fetchImpl,
      "a",
      WATCH_PARAMS,
    );
    expect(missing.ok && missing.channel.expiresAt).toBeNull();
  });

  it.each([
    ["no resourceId", { id: WATCH_PARAMS.channelId }],
    ["another channel's id", { id: "someone-else", resourceId: "r" }],
    [
      "a non-numeric expiration",
      { id: WATCH_PARAMS.channelId, resourceId: "r", expiration: "soon" },
    ],
  ])("a 200 with %s is invalid_response (Zod at the boundary)", async (_l, body) => {
    const result = await watchCalendarEvents(
      recordingFetch(() => jsonResponse(body)).fetchImpl,
      "a",
      WATCH_PARAMS,
    );
    expect(result.ok === false && result.failure).toBe("invalid_response");
  });

  it.each([
    [401, {}, "auth"],
    [403, { error: { errors: [{ domain: "global", reason: "forbidden" }] } }, "auth"],
    [
      403,
      { error: { errors: [{ domain: "usageLimits", reason: "rateLimitExceeded" }] } },
      "rate_limited",
    ],
    [429, {}, "rate_limited"],
    [503, {}, "server"],
    [400, { error: { errors: [{ reason: "pushWebhookBadDomain" }] } }, "request_rejected"],
  ])("HTTP %i is classified %s", async (status, body, failure) => {
    const result = await watchCalendarEvents(
      recordingFetch(() => jsonResponse(body, status)).fetchImpl,
      "a",
      WATCH_PARAMS,
    );
    expect(result).toMatchObject({ ok: false, failure, status });
  });

  it("a network error or timeout is `network`, never a throw", async () => {
    const failing = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const result = await watchCalendarEvents(failing, "a", WATCH_PARAMS);
    expect(result).toMatchObject({ ok: false, failure: "network", status: null });
  });

  it.each([
    ["a channel id over 64 chars", { channelId: "x".repeat(65) }],
    ["a token over 256 chars", { token: "t".repeat(257) }],
    [
      "a non-HTTPS address",
      { address: "http://kong:8000/functions/v1/webhooks-pos/google_calendar" },
    ],
  ])("refuses %s without calling Google", async (_l, override) => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({}));
    const result = await watchCalendarEvents(fetchImpl, "a", { ...WATCH_PARAMS, ...override });
    expect(result.ok === false && result.failure).toBe("request_rejected");
    expect(calls).toHaveLength(0);
  });
});

describe("stopWatchChannel (CAL-1b)", () => {
  it("POSTs {id, resourceId} to channels/stop; an empty 204 is success", async () => {
    const { fetchImpl, calls } = recordingFetch(() => new Response(null, { status: 204 }));
    const result = await stopWatchChannel(fetchImpl, "access", {
      channelId: "chan_1",
      resourceId: "res_1",
    });
    expect(result).toEqual({ ok: true, alreadyGone: false });
    expect(calls[0]?.url).toBe("https://www.googleapis.com/calendar/v3/channels/stop");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ id: "chan_1", resourceId: "res_1" });
  });

  it("a 404 means the channel is already gone (counts as stopped)", async () => {
    const result = await stopWatchChannel(
      recordingFetch(() => jsonResponse({ error: { code: 404 } }, 404)).fetchImpl,
      "a",
      { channelId: "c", resourceId: "r" },
    );
    expect(result).toEqual({ ok: true, alreadyGone: true });
  });

  it("a 401 is an auth failure (not thrown)", async () => {
    const result = await stopWatchChannel(
      recordingFetch(() => jsonResponse({}, 401)).fetchImpl,
      "a",
      { channelId: "c", resourceId: "r" },
    );
    expect(result).toMatchObject({ ok: false, failure: "auth", status: 401 });
  });
});

describe("parseGoogleCalendarNotification (CAL-1b)", () => {
  const HEADERS: Record<string, string> = {
    "x-goog-channel-id": "chan_1",
    "x-goog-channel-token": "tok_1",
    "x-goog-resource-id": "res_1",
    "x-goog-resource-state": "exists",
    "x-goog-message-number": "42",
    "x-goog-resource-uri": "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  };
  const getter = (h: Record<string, string>) => (name: string) => h[name] ?? null;

  it("reads the always-sent headers (case-insensitive lookup is the caller's Headers#get)", () => {
    const headers = new Headers({
      "X-Goog-Channel-ID": "chan_1",
      "X-Goog-Channel-Token": "tok_1",
      "X-Goog-Resource-ID": "res_1",
      "X-Goog-Resource-State": "exists",
      "X-Goog-Message-Number": "42",
    });
    expect(parseGoogleCalendarNotification((n) => headers.get(n))).toEqual({
      ok: true,
      notification: {
        channelId: "chan_1",
        channelToken: "tok_1",
        resourceId: "res_1",
        resourceState: "exists",
        messageNumber: "42",
      },
    });
  });

  it("a request without a token still parses (token null): the verifier refuses it", () => {
    const { "x-goog-channel-token": _t, ...rest } = HEADERS;
    const parsed = parseGoogleCalendarNotification(getter(rest));
    expect(parsed.ok && parsed.notification.channelToken).toBeNull();
  });

  it.each([
    ["x-goog-channel-id"],
    ["x-goog-resource-id"],
    ["x-goog-resource-state"],
    ["x-goog-message-number"],
  ])("missing %s is invalid", (name) => {
    const { [name]: _drop, ...rest } = HEADERS;
    expect(parseGoogleCalendarNotification(getter(rest))).toEqual({ ok: false, reason: "invalid" });
  });

  it.each([
    ["a non-numeric message number", { "x-goog-message-number": "abc" }],
    ["a channel id over 64 chars", { "x-goog-channel-id": "c".repeat(65) }],
    ["a token over 256 chars", { "x-goog-channel-token": "t".repeat(257) }],
    ["an empty token", { "x-goog-channel-token": "" }],
  ])("%s is invalid", (_l, override) => {
    expect(parseGoogleCalendarNotification(getter({ ...HEADERS, ...override }))).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

// ---------------------------------------------------------------------------
// CAL-1: freeBusy (multi-calendar, Zod-validated, errors[] = failure)
// ---------------------------------------------------------------------------

const WINDOW = { timeMin: "2026-10-12T00:00:00.000Z", timeMax: "2026-11-11T00:00:00.000Z" };

function freeBusyFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return jsonResponse(body, status);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("freeBusyQuery (CAL-1)", () => {
  it("posts the documented timeMin/timeMax/items shape for several calendars (deduped)", async () => {
    const { fetchImpl, calls } = freeBusyFetch({
      calendars: { primary: { busy: [] }, "staff@example.com": { busy: [] } },
    });
    await freeBusyQuery(fetchImpl, "token", {
      items: ["primary", "staff@example.com", "primary"],
      ...WINDOW,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      ...WINDOW,
      items: [{ id: "primary" }, { id: "staff@example.com" }],
    });
    expect((calls[0]?.init?.headers as Record<string, string> | undefined)?.["authorization"]).toBe(
      "Bearer token",
    );
  });

  it("returns each calendar's busy intervals as UTC instants, dropping empty ones", async () => {
    const { fetchImpl } = freeBusyFetch({
      kind: "calendar#freeBusy",
      calendars: {
        primary: {
          busy: [
            { start: "2026-10-12T09:00:00-04:00", end: "2026-10-12T10:00:00-04:00" },
            { start: "2026-10-12T15:00:00Z", end: "2026-10-12T15:00:00Z" },
          ],
        },
      },
    });
    const result = await freeBusyQuery(fetchImpl, "token", { items: ["primary"], ...WINDOW });
    expect(result).toEqual({
      ok: true,
      calendars: {
        primary: [{ start: "2026-10-12T13:00:00.000Z", end: "2026-10-12T14:00:00.000Z" }],
      },
    });
  });

  it("treats a calendar's errors[] as a FAILED read, never as free (notFound comes back with busy: [])", async () => {
    const { fetchImpl } = freeBusyFetch({
      calendars: {
        primary: { busy: [] },
        "gone@example.com": { errors: [{ domain: "global", reason: "notFound" }], busy: [] },
      },
    });
    const result = await freeBusyQuery(fetchImpl, "token", {
      items: ["primary", "gone@example.com"],
      ...WINDOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toBe("calendar_error");
      expect(result.detail).toContain("notFound");
    }
  });

  it("an unlisted error reason is still a failure", async () => {
    const { fetchImpl } = freeBusyFetch({
      calendars: { primary: { busy: [], errors: [{ domain: "x", reason: "somethingNew" }] } },
    });
    const result = await freeBusyQuery(fetchImpl, "token", { items: ["primary"], ...WINDOW });
    expect(result.ok === false && result.failure).toBe("calendar_error");
  });

  it("a requested calendar missing from the answer is a failure", async () => {
    const { fetchImpl } = freeBusyFetch({ calendars: { primary: { busy: [] } } });
    const result = await freeBusyQuery(fetchImpl, "token", {
      items: ["primary", "staff@example.com"],
      ...WINDOW,
    });
    expect(result.ok === false && result.failure).toBe("calendar_error");
  });

  it("VERIFY: a single-calendar answer keyed by the account email (not 'primary') is still read", async () => {
    const { fetchImpl } = freeBusyFetch({
      calendars: {
        "owner@example.com": {
          busy: [{ start: "2026-10-12T13:00:00Z", end: "2026-10-12T14:00:00Z" }],
        },
      },
    });
    const result = await freeBusyQuery(fetchImpl, "token", { items: ["primary"], ...WINDOW });
    expect(result).toEqual({
      ok: true,
      calendars: {
        primary: [{ start: "2026-10-12T13:00:00.000Z", end: "2026-10-12T14:00:00.000Z" }],
      },
    });
  });

  it.each([
    ["no calendars map", { kind: "calendar#freeBusy" }],
    ["a calendar entry without busy[]", { calendars: { primary: {} } }],
    [
      "an unreadable busy time",
      { calendars: { primary: { busy: [{ start: "soon", end: "later" }] } } },
    ],
    ["a non-JSON body", undefined],
  ])("rejects %s as invalid_response", async (_label, body) => {
    const fetchImpl = (async () =>
      body === undefined
        ? new Response("<html>", { status: 200 })
        : jsonResponse(body)) as unknown as typeof fetch;
    const result = await freeBusyQuery(fetchImpl, "token", { items: ["primary"], ...WINDOW });
    expect(result.ok === false && result.failure).toBe("invalid_response");
  });

  it.each([
    [401, { error: { code: 401, status: "UNAUTHENTICATED" } }, "auth"],
    [403, { error: { errors: [{ domain: "global", reason: "insufficientPermissions" }] } }, "auth"],
    [
      403,
      { error: { errors: [{ domain: "usageLimits", reason: "rateLimitExceeded" }] } },
      "rate_limited",
    ],
    [
      403,
      { error: { errors: [{ domain: "global", reason: "userRateLimitExceeded" }] } },
      "rate_limited",
    ],
    [429, { error: { code: 429 } }, "rate_limited"],
    [500, { error: { code: 500 } }, "server"],
    [503, undefined, "server"],
    [400, { error: { errors: [{ reason: "timeRangeTooLong" }] } }, "request_rejected"],
  ])("classifies HTTP %i as %s", async (status, body, failure) => {
    const { fetchImpl } = freeBusyFetch(body, status);
    const result = await freeBusyQuery(fetchImpl, "token", { items: ["primary"], ...WINDOW });
    expect(result).toMatchObject({ ok: false, failure, status });
  });

  it("a network error or timeout is `network`, never a throw", async () => {
    const throwing = (async () => {
      throw new TypeError("connection reset");
    }) as unknown as typeof fetch;
    const failed = await freeBusyQuery(throwing, "token", { items: ["primary"], ...WINDOW });
    expect(failed).toMatchObject({ ok: false, failure: "network", status: null });

    const controller = new AbortController();
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const pending = freeBusyQuery(hanging, "token", {
      items: ["primary"],
      ...WINDOW,
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toEqual({
      ok: false,
      failure: "network",
      status: null,
      detail: "freeBusy timed out",
    });
  });

  it("refuses zero or more than 50 calendars without calling Google", async () => {
    const { fetchImpl, calls } = freeBusyFetch({ calendars: {} });
    const none = await freeBusyQuery(fetchImpl, "token", { items: [], ...WINDOW });
    const tooMany = await freeBusyQuery(fetchImpl, "token", {
      items: Array.from({ length: 51 }, (_, i) => `cal${i}@example.com`),
      ...WINDOW,
    });
    expect(none.ok === false && none.failure).toBe("request_rejected");
    expect(tooMany.ok === false && tooMany.failure).toBe("request_rejected");
    expect(calls).toHaveLength(0);
  });
});

describe("Google token responses (CAL-1, Zod at the boundary)", () => {
  it("parses a documented token response with its granted scopes", () => {
    expect(
      parseGoogleTokenResponse({
        ok: true,
        status: 200,
        body: {
          access_token: "ya29.x",
          expires_in: 3599,
          refresh_token: "1//r",
          scope: `${GOOGLE_CALENDAR_OAUTH_SCOPES[1]} ${GOOGLE_CALENDAR_OAUTH_SCOPES[0]}`,
          token_type: "Bearer",
        },
      }),
    ).toEqual({
      ok: true,
      grant: {
        accessToken: "ya29.x",
        expiresInSeconds: 3599,
        refreshToken: "1//r",
        grantedScopes: [GOOGLE_CALENDAR_OAUTH_SCOPES[1], GOOGLE_CALENDAR_OAUTH_SCOPES[0]],
      },
    });
  });

  it("a response without a refresh token or scope field still parses (refresh answers omit both)", () => {
    const parsed = parseGoogleTokenResponse({
      ok: true,
      status: 200,
      body: { access_token: "ya29.y", expires_in: 3600 },
    });
    expect(parsed).toEqual({
      ok: true,
      grant: { accessToken: "ya29.y", expiresInSeconds: 3600, grantedScopes: null },
    });
  });

  it.each([
    ["no access_token", { expires_in: 3600 }],
    ["no expires_in", { access_token: "a" }],
    ["a string expires_in", { access_token: "a", expires_in: "3600" }],
    ["no body", undefined],
  ])("a 200 with %s is invalid_response", (_label, body) => {
    expect(parseGoogleTokenResponse({ ok: true, status: 200, body })).toMatchObject({
      ok: false,
      failure: "invalid_response",
    });
  });

  it("invalid_grant means the owner must reconnect; our client errors and outages do not", () => {
    expect(
      parseGoogleTokenResponse({
        ok: false,
        status: 400,
        body: { error: "invalid_grant", error_description: "Token has been expired or revoked." },
      }),
    ).toMatchObject({ ok: false, failure: "invalid_grant", status: 400 });
    expect(
      parseGoogleTokenResponse({ ok: false, status: 401, body: { error: "invalid_client" } }),
    ).toMatchObject({ ok: false, failure: "client_config" });
    expect(parseGoogleTokenResponse({ ok: false, status: 503, body: undefined })).toMatchObject({
      ok: false,
      failure: "transient",
    });
    expect(parseGoogleTokenResponse({ ok: false, status: 429, body: {} })).toMatchObject({
      ok: false,
      failure: "transient",
    });
  });

  it("refreshGoogleAccessToken posts the refresh grant with the caller's signal, and never throws", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = init;
      return jsonResponse({ access_token: "new", expires_in: 3600 });
    }) as typeof fetch;
    const signal = new AbortController().signal;
    const result = await refreshGoogleAccessToken(fetchImpl, {
      clientId: "c",
      clientSecret: "s",
      refreshToken: "r",
      signal,
    });
    expect(result.ok).toBe(true);
    expect(captured?.signal).toBe(signal);
    const form = new URLSearchParams(String(captured?.body));
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("r");

    const throwing = (async () => {
      throw new TypeError("dns");
    }) as unknown as typeof fetch;
    expect(
      await refreshGoogleAccessToken(throwing, {
        clientId: "c",
        clientSecret: "s",
        refreshToken: "r",
      }),
    ).toMatchObject({ ok: false, failure: "transient", status: null });
  });

  it("exchangeGoogleAuthCode posts the authorization_code grant with the redirect URI", async () => {
    let form: URLSearchParams | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://oauth2.googleapis.com/token");
      form = new URLSearchParams(String(init?.body));
      return jsonResponse({ access_token: "a", expires_in: 3600, refresh_token: "r" });
    }) as typeof fetch;
    const result = await exchangeGoogleAuthCode(fetchImpl, {
      clientId: "c",
      clientSecret: "s",
      redirectUri: "https://app.example/cb",
      code: "code_1",
    });
    expect(result.ok).toBe(true);
    expect(form?.get("grant_type")).toBe("authorization_code");
    expect(form?.get("code")).toBe("code_1");
    expect(form?.get("redirect_uri")).toBe("https://app.example/cb");
  });
});

describe("missingGoogleCalendarPermissions (CAL-1 granular consent)", () => {
  const base = "https://www.googleapis.com/auth/";
  it("the two requested scopes cover both features", () => {
    expect(missingGoogleCalendarPermissions([...GOOGLE_CALENDAR_OAUTH_SCOPES])).toEqual([]);
  });
  it("the broad calendar scope (an older connection) covers both", () => {
    expect(missingGoogleCalendarPermissions([`${base}calendar`])).toEqual([]);
  });
  it("names what an owner unticked", () => {
    expect(missingGoogleCalendarPermissions([`${base}calendar.events`])).toEqual(["busy_times"]);
    expect(missingGoogleCalendarPermissions([`${base}calendar.freebusy`])).toEqual(["events"]);
    expect(missingGoogleCalendarPermissions([])).toEqual(["busy_times", "events"]);
  });
  it("calendar.events.freebusy also reads busy times", () => {
    expect(
      missingGoogleCalendarPermissions([
        `${base}calendar.events.freebusy`,
        `${base}calendar.events`,
      ]),
    ).toEqual([]);
  });
});
