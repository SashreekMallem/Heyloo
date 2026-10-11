import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../crypto.ts";
import type { Logger } from "../types.ts";
import {
  CALENDAR_WATCH_TTL_SECONDS,
  channelTokenMatches,
  googleCalendarWebhookAddress,
  newWatchChannel,
  stopChannelBestEffort,
} from "./watch.ts";

function logger() {
  return {
    debug: vi.fn<Logger["debug"]>(),
    info: vi.fn<Logger["info"]>(),
    warn: vi.fn<Logger["warn"]>(),
    error: vi.fn<Logger["error"]>(),
  };
}

describe("newWatchChannel", () => {
  it("is a fresh UUID id and a random 256-bit token whose SHA-256 hex is what gets stored", async () => {
    const a = await newWatchChannel();
    const b = await newWatchChannel();
    expect(a.channelId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.channelId).not.toBe(b.channelId);
    expect(a.token).not.toBe(b.token);
    // URL-safe, inside Google's 256-char token limit
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.tokenHash).toBe(await sha256Hex(a.token));
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).not.toContain(a.token);
  });

  it("asks for Google's documented default lifetime (7 days)", () => {
    expect(CALENDAR_WATCH_TTL_SECONDS).toBe(604_800);
  });
});

describe("channelTokenMatches (fail closed)", () => {
  it("matches only the token whose hash is stored", async () => {
    const channel = await newWatchChannel();
    expect(await channelTokenMatches(channel.token, channel.tokenHash)).toBe(true);
    expect(await channelTokenMatches(`${channel.token}x`, channel.tokenHash)).toBe(false);
    expect(await channelTokenMatches("wrong", channel.tokenHash)).toBe(false);
  });

  it("the stored hash itself is not a valid token", async () => {
    const channel = await newWatchChannel();
    expect(await channelTokenMatches(channel.tokenHash, channel.tokenHash)).toBe(false);
  });

  it("a missing token or a missing stored hash never matches", async () => {
    const channel = await newWatchChannel();
    expect(await channelTokenMatches(null, channel.tokenHash)).toBe(false);
    expect(await channelTokenMatches("", channel.tokenHash)).toBe(false);
    expect(await channelTokenMatches(channel.token, null)).toBe(false);
  });
});

describe("googleCalendarWebhookAddress", () => {
  it("is this project's webhooks-pos google_calendar route", () => {
    expect(googleCalendarWebhookAddress("https://abc.supabase.co")).toBe(
      "https://abc.supabase.co/functions/v1/webhooks-pos/google_calendar",
    );
    expect(googleCalendarWebhookAddress("https://abc.supabase.co/")).toBe(
      "https://abc.supabase.co/functions/v1/webhooks-pos/google_calendar",
    );
  });

  it("is null without an HTTPS project URL (Google only delivers to HTTPS)", () => {
    expect(googleCalendarWebhookAddress(undefined)).toBeNull();
    expect(googleCalendarWebhookAddress("")).toBeNull();
    expect(googleCalendarWebhookAddress("http://kong:8000")).toBeNull();
    expect(googleCalendarWebhookAddress("not a url")).toBeNull();
  });
});

describe("stopChannelBestEffort", () => {
  it("stops via channels.stop and reports it", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${url} ${String(init?.body)}`);
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const outcome = await stopChannelBestEffort(
      fetchImpl,
      "access",
      { channelId: "c1", resourceId: "r1" },
      logger(),
      {},
    );
    expect(outcome).toBe("stopped");
    expect(calls[0]).toContain("/channels/stop");
    expect(calls[0]).toContain('"id":"c1"');
  });

  it("a channel that is already gone (404) is fine", async () => {
    const fetchImpl = (async () => Response.json({}, { status: 404 })) as unknown as typeof fetch;
    expect(
      await stopChannelBestEffort(
        fetchImpl,
        "a",
        { channelId: "c", resourceId: "r" },
        logger(),
        {},
      ),
    ).toBe("already_gone");
  });

  it("a failure is logged and returned, never thrown", async () => {
    const log = logger();
    const fetchImpl = (async () => Response.json({}, { status: 500 })) as unknown as typeof fetch;
    const outcome = await stopChannelBestEffort(
      fetchImpl,
      "a",
      { channelId: "c", resourceId: "r" },
      log,
      { tenant_id: "t1" },
    );
    expect(outcome).toBe("server");
    expect(log.warn).toHaveBeenCalledWith(
      "calendar_watch_stop_failed",
      expect.objectContaining({ tenant_id: "t1", channel_id: "c", failure: "server" }),
    );
  });

  it("a hanging stop is cut off at the timeout", async () => {
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const started = Date.now();
    const outcome = await stopChannelBestEffort(
      hanging,
      "a",
      { channelId: "c", resourceId: "r" },
      logger(),
      {},
      20,
    );
    expect(outcome).toBe("network");
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
