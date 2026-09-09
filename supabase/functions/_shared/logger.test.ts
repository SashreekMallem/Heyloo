import { describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.ts";

describe("createLogger", () => {
  it("emits one JSON line per call, merging base fields under the given level", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const logger = createLogger({ fn: "voice-tools" });

    logger.info("check_availability_ok", { tool: "check_availability" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(line).toMatchObject({
      level: "info",
      msg: "check_availability_ok",
      fn: "voice-tools",
      tool: "check_availability",
    });
    expect(typeof line.ts).toBe("string");
    logSpy.mockRestore();
  });

  it("routes warn/error to console.warn/console.error, everything else to console.log", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createLogger();

    logger.warn("w");
    logger.error("e");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("never reports to Sentry when no DSN is configured (no fetch call)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    const logger = createLogger({ fn: "voice-tools" }, { sentryFetch: fetchMock });

    logger.error("voice_tools_dispatch_error", { tool: "check_availability" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("posts a Sentry envelope on error() when a DSN is supplied, tagging with base fields", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const logger = createLogger(
      { fn: "voice-tools" },
      { sentryDsn: "https://key@o1.ingest.sentry.io/9", sentryFetch: fetchMock },
    );

    logger.error("voice_tools_dispatch_error", { tool: "check_availability" });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://o1.ingest.sentry.io/api/9/envelope/");
    const body = init.body as string;
    const payloadLine = body.trimEnd().split("\n")[2] ?? "{}";
    const payload = JSON.parse(payloadLine);
    expect(payload.message.formatted).toBe("voice_tools_dispatch_error");
    expect(payload.tags).toEqual({ fn: "voice-tools" });
    expect(payload.extra).toEqual({ tool: "check_availability" });
    errorSpy.mockRestore();
  });

  it("never fires Sentry for debug/info/warn, only error", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const logger = createLogger(
      {},
      { sentryDsn: "https://key@o1.ingest.sentry.io/9", sentryFetch: fetchMock },
    );

    logger.debug("d");
    logger.info("i");
    logger.warn("w");

    expect(fetchMock).not.toHaveBeenCalled();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
