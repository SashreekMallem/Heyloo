import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import {
  buildJoinMessage,
  KEEPALIVE_CHANNEL,
  type KeepaliveSocket,
  realtimeSocketUrl,
  runRealtimeKeepalive,
} from "./handler.ts";

const logger = createLogger();

class FakeSocket implements KeepaliveSocket {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  sent: string[] = [];
  closed = false;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
}

function reply(status: string, response: unknown = {}, ref = "1", topic = KEEPALIVE_CHANNEL) {
  return JSON.stringify(["1", ref, topic, "phx_reply", { status, response }]);
}

describe("realtimeSocketUrl", () => {
  it("targets the documented Realtime websocket endpoint", () => {
    expect(realtimeSocketUrl("https://abc.supabase.co", "sb_publishable_x")).toBe(
      "wss://abc.supabase.co/realtime/v1/websocket?apikey=sb_publishable_x&vsn=2.0.0",
    );
    expect(realtimeSocketUrl("http://127.0.0.1:54321", "k")).toMatch(
      /^ws:\/\/127\.0\.0\.1:54321\//,
    );
  });
});

describe("buildJoinMessage", () => {
  it("is a v2 phx_join for a public broadcast channel with no presence or db changes", () => {
    const frame = JSON.parse(buildJoinMessage());
    expect(frame[2]).toBe(KEEPALIVE_CHANNEL);
    expect(frame[3]).toBe("phx_join");
    expect(frame[4].config.private).toBe(false);
    expect(frame[4].config.postgres_changes).toEqual([]);
  });
});

describe("runRealtimeKeepalive", () => {
  it("joins the channel, succeeds on the ok reply and closes the socket", async () => {
    const socket = new FakeSocket();
    const p = runRealtimeKeepalive({
      supabaseUrl: "https://abc.supabase.co",
      apiKey: "k",
      createSocket: () => socket,
      logger,
    });
    socket.onopen?.({});
    expect(socket.sent).toHaveLength(1);
    // heartbeat replies and other topics are ignored
    socket.onmessage?.({ data: reply("ok", {}, "1", "phoenix") });
    socket.onmessage?.({ data: "not json" });
    socket.onmessage?.({ data: reply("ok") });
    await expect(p).resolves.toEqual({ ok: true });
    expect(socket.closed).toBe(true);
  });

  it("reports a join error with the server's reason", async () => {
    const socket = new FakeSocket();
    const p = runRealtimeKeepalive({
      supabaseUrl: "https://abc.supabase.co",
      apiKey: "k",
      createSocket: () => socket,
      logger,
    });
    socket.onopen?.({});
    socket.onmessage?.({ data: reply("error", { reason: "InvalidJWTToken: nope" }) });
    await expect(p).resolves.toEqual({
      ok: false,
      reason: "join_error",
      detail: "InvalidJWTToken: nope",
    });
  });

  it("times out when the server never answers, and never throws", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const p = runRealtimeKeepalive({
        supabaseUrl: "https://abc.supabase.co",
        apiKey: "k",
        createSocket: () => socket,
        logger,
        timeoutMs: 50,
      });
      await vi.advanceTimersByTimeAsync(60);
      await expect(p).resolves.toEqual({ ok: false, reason: "timeout" });
      expect(socket.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps socket errors, early closes and constructor failures to outcomes", async () => {
    const s1 = new FakeSocket();
    const p1 = runRealtimeKeepalive({
      supabaseUrl: "https://abc.supabase.co",
      apiKey: "k",
      createSocket: () => s1,
      logger,
    });
    s1.onerror?.({});
    await expect(p1).resolves.toEqual({ ok: false, reason: "socket_error" });

    const s2 = new FakeSocket();
    const p2 = runRealtimeKeepalive({
      supabaseUrl: "https://abc.supabase.co",
      apiKey: "k",
      createSocket: () => s2,
      logger,
    });
    s2.onclose?.({});
    await expect(p2).resolves.toEqual({ ok: false, reason: "closed" });

    await expect(
      runRealtimeKeepalive({
        supabaseUrl: "https://abc.supabase.co",
        apiKey: "k",
        createSocket: () => {
          throw new Error("boom");
        },
        logger,
      }),
    ).resolves.toEqual({ ok: false, reason: "socket_error", detail: "boom" });
  });

  it("never logs the api key", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((m: unknown) => {
      lines.push(String(m));
    });
    const spyW = vi.spyOn(console, "warn").mockImplementation((m: unknown) => {
      lines.push(String(m));
    });
    try {
      const s = new FakeSocket();
      const p = runRealtimeKeepalive({
        supabaseUrl: "https://abc.supabase.co",
        apiKey: "sb_publishable_SECRETISH",
        createSocket: () => s,
        logger,
      });
      s.onerror?.({});
      await p;
    } finally {
      spy.mockRestore();
      spyW.mockRestore();
    }
    expect(lines.join("\n")).not.toContain("SECRETISH");
  });
});
