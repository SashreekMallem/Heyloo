import { VoiceProviderError } from "@heyloo/canonical-types";
import { describe, expect, it, vi } from "vitest";
import { RetellClient } from "./client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("RetellClient", () => {
  it("throws (fail closed) when constructed without an apiKey", () => {
    expect(() => new RetellClient({ apiKey: "" })).toThrow(VoiceProviderError);
  });

  it("sends a Bearer auth header and returns a parsed JSON body on 2xx", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer test-key");
      return jsonResponse(200, { agent_id: "agent_1" });
    });
    const client = new RetellClient({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.request<{ agent_id: string }>("POST", "/create-agent", {
      foo: "bar",
    });
    expect(result).toEqual({ agent_id: "agent_1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries on a 500 and eventually succeeds", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call < 3) return jsonResponse(500, { error: "boom" });
      return jsonResponse(200, { ok: true });
    });
    const sleep = vi.fn(async () => {});
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
      maxAttempts: 3,
      baseDelayMs: 10,
    });

    const result = await client.request("GET", "/get-concurrency");
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 rate limiting", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return jsonResponse(429, { error: "rate limited" });
      return jsonResponse(200, { ok: true });
    });
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      maxAttempts: 2,
    });
    expect(await client.request("GET", "/x")).toEqual({ ok: true });
  });

  it("throws a typed, non-retryable error on a 4xx and does NOT retry", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: "bad request" }));
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 3,
      sleep: async () => {},
    });

    await expect(client.request("POST", "/create-agent", {})).rejects.toMatchObject({
      code: "validation",
      retryable: false,
      httpStatus: 400,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws a typed auth error on 401", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: "unauthorized" }));
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.request("GET", "/get-concurrency")).rejects.toMatchObject({
      code: "auth",
      retryable: false,
      httpStatus: 401,
    });
  });

  it("exhausts retries on persistent 5xx and throws a retryable server_error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { error: "unavailable" }));
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 3,
      sleep: async () => {},
    });
    await expect(client.request("GET", "/x")).rejects.toMatchObject({
      code: "server_error",
      retryable: true,
      httpStatus: 503,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries on a network-level failure and eventually throws a retryable network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 2,
      sleep: async () => {},
    });
    await expect(client.request("GET", "/x")).rejects.toMatchObject({
      code: "network",
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("handles a 204 with no body", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await client.request("DELETE", "/delete-agent/agent_1")).toBeUndefined();
  });
});
