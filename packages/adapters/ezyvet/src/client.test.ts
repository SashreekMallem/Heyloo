import { VoiceProviderError } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import { EzyVetClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("EzyVetClient rate limiting (180/min per database per partner)", () => {
  it("lets requests through immediately while under the per-minute limit", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const client = new EzyVetClient({
      baseUrl: "https://clinic.ezyvet.com/api/v1",
      fetchImpl: (async () => jsonResponse({ ok: true })) as unknown as typeof fetch,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      rateLimitPerMinute: 3,
    });

    await client.request("GET", "/ping", "token");
    await client.request("GET", "/ping", "token");
    await client.request("GET", "/ping", "token");

    expect(sleeps).toEqual([]);
  });

  it("sleeps until the sliding window frees up once the per-minute limit is hit", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const client = new EzyVetClient({
      baseUrl: "https://clinic.ezyvet.com/api/v1",
      fetchImpl: (async () => jsonResponse({ ok: true })) as unknown as typeof fetch,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      rateLimitPerMinute: 2,
    });

    await client.request("GET", "/ping", "token");
    await client.request("GET", "/ping", "token");
    // Third request within the same window must wait for the oldest of the
    // two prior requests to fall outside the 60s window.
    await client.request("GET", "/ping", "token");

    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps[0]).toBeGreaterThan(0);
  });

  it("throws when called with no access token", async () => {
    const client = new EzyVetClient({ baseUrl: "https://clinic.ezyvet.com/api/v1" });
    await expect(client.request("GET", "/ping", "")).rejects.toBeInstanceOf(VoiceProviderError);
  });
});
