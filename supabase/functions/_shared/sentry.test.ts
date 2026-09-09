import { describe, expect, it, vi } from "vitest";
import {
  buildErrorEnvelope,
  envelopeEndpoint,
  parseDsn,
  randomEventId,
  sendToSentry,
} from "./sentry.ts";

describe("parseDsn", () => {
  it("parses a standard SaaS DSN", () => {
    const parsed = parseDsn("https://abc123@o456.ingest.us.sentry.io/789");
    expect(parsed).toEqual({
      publicKey: "abc123",
      host: "o456.ingest.us.sentry.io",
      projectId: "789",
      pathPrefix: "",
    });
  });

  it("parses a self-hosted DSN with a path prefix", () => {
    const parsed = parseDsn("https://key@sentry.example.com/self-hosted/12");
    expect(parsed).toEqual({
      publicKey: "key",
      host: "sentry.example.com",
      projectId: "12",
      pathPrefix: "/self-hosted",
    });
  });

  it("returns undefined for a non-URL string", () => {
    expect(parseDsn("not-a-dsn")).toBeUndefined();
  });

  it("returns undefined when the public key (username) is missing", () => {
    expect(parseDsn("https://sentry.example.com/12")).toBeUndefined();
  });

  it("returns undefined when there is no project id in the path", () => {
    expect(parseDsn("https://key@sentry.example.com/")).toBeUndefined();
  });
});

describe("envelopeEndpoint", () => {
  it("builds the /api/<project_id>/envelope/ URL", () => {
    const url = envelopeEndpoint({
      publicKey: "abc",
      host: "o1.ingest.sentry.io",
      projectId: "42",
      pathPrefix: "",
    });
    expect(url).toBe("https://o1.ingest.sentry.io/api/42/envelope/");
  });

  it("includes a self-hosted path prefix before /api/", () => {
    const url = envelopeEndpoint({
      publicKey: "abc",
      host: "sentry.example.com",
      projectId: "42",
      pathPrefix: "/self-hosted",
    });
    expect(url).toBe("https://sentry.example.com/self-hosted/api/42/envelope/");
  });
});

describe("randomEventId", () => {
  it("returns 32 lowercase hex characters", () => {
    const id = randomEventId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is different on every call", () => {
    expect(randomEventId()).not.toBe(randomEventId());
  });
});

describe("buildErrorEnvelope", () => {
  const dsn = "https://abc123@o456.ingest.us.sentry.io/789";

  it("returns undefined when the DSN doesn't parse", () => {
    expect(
      buildErrorEnvelope({ dsn: "garbage" }, { message: "x", level: "error" }),
    ).toBeUndefined();
  });

  it("builds a three-line newline-delimited envelope with a matching endpoint", () => {
    const eventId = "0".repeat(32);
    const sentAt = new Date("2026-09-07T12:00:00.000Z");
    const built = buildErrorEnvelope(
      { dsn, environment: "production", release: "heyloo@1.2.3", eventId, sentAt },
      {
        message: "voice_tools_dispatch_error",
        level: "error",
        tags: { fn: "voice-tools" },
        extra: { tool: "check_availability" },
      },
    );
    expect(built).toBeDefined();
    expect(built?.url).toBe("https://o456.ingest.us.sentry.io/api/789/envelope/");

    const lines = built?.body.trimEnd().split("\n") ?? [];
    expect(lines).toHaveLength(3);

    const envelopeHeader = JSON.parse(lines[0] ?? "{}");
    expect(envelopeHeader).toEqual({ event_id: eventId, sent_at: sentAt.toISOString(), dsn });

    const itemHeader = JSON.parse(lines[1] ?? "{}");
    expect(itemHeader).toEqual({ type: "event", content_type: "application/json" });

    const payload = JSON.parse(lines[2] ?? "{}");
    expect(payload).toMatchObject({
      event_id: eventId,
      timestamp: sentAt.toISOString(),
      platform: "other",
      level: "error",
      message: { formatted: "voice_tools_dispatch_error" },
      environment: "production",
      release: "heyloo@1.2.3",
      tags: { fn: "voice-tools" },
      extra: { tool: "check_availability" },
    });
  });

  it("defaults environment to 'production' and omits release when not given", () => {
    const built = buildErrorEnvelope({ dsn }, { message: "m", level: "warning" });
    const payload = JSON.parse(built?.body.trimEnd().split("\n")[2] ?? "{}");
    expect(payload.environment).toBe("production");
    expect(payload.release).toBeUndefined();
  });
});

describe("sendToSentry", () => {
  it("POSTs the built envelope with the application/x-sentry-envelope content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    sendToSentry(
      { dsn: "https://abc@o1.ingest.sentry.io/1" },
      { message: "boom", level: "error" },
      fetchMock,
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://o1.ingest.sentry.io/api/1/envelope/");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-sentry-envelope",
    );
    expect(typeof init.body).toBe("string");
  });

  it("is a silent no-op when the DSN doesn't parse (never calls fetch)", () => {
    const fetchMock = vi.fn();
    sendToSentry({ dsn: "garbage" }, { message: "boom", level: "error" }, fetchMock);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows a rejected fetch instead of throwing or rejecting", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    expect(() =>
      sendToSentry(
        { dsn: "https://abc@o1.ingest.sentry.io/1" },
        { message: "boom", level: "error" },
        fetchMock,
      ),
    ).not.toThrow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
