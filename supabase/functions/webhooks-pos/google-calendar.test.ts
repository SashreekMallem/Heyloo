import { beforeAll, describe, expect, it, vi } from "vitest";
import { newWatchChannel } from "../_shared/calendar/watch.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import { handleGoogleCalendarNotification } from "./google-calendar.ts";

interface Call {
  text: string;
  values: unknown[];
}

let CHANNEL: { channelId: string; token: string; tokenHash: string };
beforeAll(async () => {
  CHANNEL = await newWatchChannel();
});

function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    tenant_id: "tenant-1",
    status: "connected",
    watch_resource_id: "res-1",
    watch_token_hash: CHANNEL.tokenHash,
    ...overrides,
  };
}

function makeSql(opts: { lookup?: unknown[]; record?: unknown[] } = {}) {
  const calls: Call[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    if (text.includes("google_calendar_notification:lookup")) return opts.lookup ?? [];
    if (text.includes("google_calendar_notification:record"))
      return opts.record ?? [{ inserted: 1, requested: 1 }];
    return [];
  }) as SqlClient;
  return { sql, calls };
}

function logger() {
  return {
    debug: vi.fn<Logger["debug"]>(),
    info: vi.fn<Logger["info"]>(),
    warn: vi.fn<Logger["warn"]>(),
    error: vi.fn<Logger["error"]>(),
  };
}

function headers(overrides: Record<string, string | null> = {}) {
  const base: Record<string, string | null> = {
    "x-goog-channel-id": CHANNEL.channelId,
    "x-goog-channel-token": CHANNEL.token,
    "x-goog-resource-id": "res-1",
    "x-goog-resource-state": "exists",
    "x-goog-message-number": "7",
    "x-goog-resource-uri": "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    ...overrides,
  };
  return (name: string) => base[name.toLowerCase()] ?? null;
}

describe("handleGoogleCalendarNotification — verification (fail closed)", () => {
  it("a verified change is recorded once in webhook_events and requests a read, 200", async () => {
    const { sql, calls } = makeSql({ lookup: [connectionRow()] });
    const log = logger();
    const result = await handleGoogleCalendarNotification(sql, headers(), log);
    expect(result).toEqual({ status: 200, body: { received: true } });

    const lookup = calls[0];
    expect(lookup?.text).toContain("where provider = 'google_calendar' and watch_channel_id =");
    expect(lookup?.values).toEqual([CHANNEL.channelId]);

    const record = calls[1];
    expect(calls).toHaveLength(2);
    // idempotent insert first; the read request only when that insert is new
    expect(record?.text).toContain("insert into public.webhook_events");
    expect(record?.text).toContain("on conflict (source, event_id) do nothing");
    expect(record?.text).toContain("'google_calendar'");
    expect(record?.values).toContain(`${CHANNEL.channelId}:7`);
    expect(record?.text).toMatch(/set busy_sync_requested_at = now\(\)\s+from ev/);
    expect(record?.text).toContain("c.status = 'connected'");
    // the tenant comes from the stored channel's row, never the request
    expect(record?.values).toContain("conn-1");
    expect(record?.values).toContain("tenant-1");
    // the token is never stored in the event payload
    expect(JSON.stringify(record?.values)).not.toContain(CHANNEL.token);
    expect(log.info).toHaveBeenCalledWith(
      "pos_google_calendar_change_notified",
      expect.objectContaining({ duplicate: false, read_requested: true }),
    );
  });

  it("a redelivered notification (same channel + message number) is deduped: 200, no second request", async () => {
    const { sql } = makeSql({
      lookup: [connectionRow()],
      record: [{ inserted: 0, requested: 0 }],
    });
    const log = logger();
    const result = await handleGoogleCalendarNotification(sql, headers(), log);
    expect(result.status).toBe(200);
    expect(log.info).toHaveBeenCalledWith(
      "pos_google_calendar_change_notified",
      expect.objectContaining({ duplicate: true, read_requested: false }),
    );
  });

  it("not_exists is a change too", async () => {
    const { sql, calls } = makeSql({ lookup: [connectionRow()] });
    await handleGoogleCalendarNotification(
      sql,
      headers({ "x-goog-resource-state": "not_exists" }),
      logger(),
    );
    expect(calls[1]?.text).toContain("insert into public.webhook_events");
  });

  it("the `sync` message (channel created) is verified, then a 200 no-op", async () => {
    const { sql, calls } = makeSql({ lookup: [connectionRow()] });
    const result = await handleGoogleCalendarNotification(
      sql,
      headers({ "x-goog-resource-state": "sync", "x-goog-message-number": "1" }),
      logger(),
    );
    expect(result).toEqual({ status: 200, body: { received: true } });
    expect(calls).toHaveLength(1); // lookup only: nothing recorded or requested
  });

  it("a wrong token is 401 and writes nothing", async () => {
    const { sql, calls } = makeSql({ lookup: [connectionRow()] });
    const log = logger();
    const result = await handleGoogleCalendarNotification(
      sql,
      headers({ "x-goog-channel-token": `${CHANNEL.token}x` }),
      log,
    );
    expect(result).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(calls).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(
      "pos_google_calendar_rejected",
      expect.objectContaining({ reason: "token_mismatch" }),
    );
  });

  it("presenting the stored hash as the token is refused", async () => {
    const { sql, calls } = makeSql({ lookup: [connectionRow()] });
    const result = await handleGoogleCalendarNotification(
      sql,
      headers({ "x-goog-channel-token": CHANNEL.tokenHash }),
      logger(),
    );
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  it("a missing token is 401", async () => {
    const { sql, calls } = makeSql({ lookup: [connectionRow()] });
    const log = logger();
    const result = await handleGoogleCalendarNotification(
      sql,
      headers({ "x-goog-channel-token": null }),
      log,
    );
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(
      "pos_google_calendar_rejected",
      expect.objectContaining({ reason: "token_missing" }),
    );
  });

  it("a channel with no stored hash never verifies (fail closed)", async () => {
    const { sql, calls } = makeSql({ lookup: [connectionRow({ watch_token_hash: null })] });
    const result = await handleGoogleCalendarNotification(sql, headers(), logger());
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  it("an unknown (or replaced/stopped) channel is 401", async () => {
    const { sql, calls } = makeSql({ lookup: [] });
    const log = logger();
    const result = await handleGoogleCalendarNotification(sql, headers(), log);
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(
      "pos_google_calendar_rejected",
      expect.objectContaining({ reason: "unknown_channel" }),
    );
  });

  it("a resource id that is not the channel's is 401 even with the right token", async () => {
    const { sql, calls } = makeSql({ lookup: [connectionRow()] });
    const log = logger();
    const result = await handleGoogleCalendarNotification(
      sql,
      headers({ "x-goog-resource-id": "res-other" }),
      log,
    );
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(
      "pos_google_calendar_rejected",
      expect.objectContaining({ reason: "resource_mismatch" }),
    );
  });

  it("a channel with no stored resource id is 401", async () => {
    const { sql } = makeSql({ lookup: [connectionRow({ watch_resource_id: null })] });
    const result = await handleGoogleCalendarNotification(sql, headers(), logger());
    expect(result.status).toBe(401);
  });

  it.each([
    ["no channel id", { "x-goog-channel-id": null }],
    ["no resource id", { "x-goog-resource-id": null }],
    ["no resource state", { "x-goog-resource-state": null }],
    ["no message number", { "x-goog-message-number": null }],
    ["a non-numeric message number", { "x-goog-message-number": "seven" }],
  ])("%s is 401 before any database read", async (_l, override) => {
    const { sql, calls } = makeSql({ lookup: [connectionRow()] });
    const result = await handleGoogleCalendarNotification(sql, headers(override), logger());
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("a verified notification for a connection that is no longer connected is acked without a read request", async () => {
    const { sql, calls } = makeSql({
      lookup: [connectionRow({ status: "disconnected" })],
      record: [{ inserted: 1, requested: 0 }],
    });
    const result = await handleGoogleCalendarNotification(sql, headers(), logger());
    expect(result.status).toBe(200);
    // the guard lives in the statement itself (status = 'connected')
    expect(calls[1]?.text).toContain("c.status = 'connected'");
  });
});
