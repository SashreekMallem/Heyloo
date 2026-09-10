import { describe, expect, it } from "vitest";
import { geocodeAddress } from "./geocode.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("geocodeAddress", () => {
  it("returns the top result's lat/lng on success", async () => {
    let requestedUrl = "";
    const fetchImpl = (async (url: string) => {
      requestedUrl = url;
      return jsonResponse({
        results: [{ location: { lat: 30.2672, lng: -97.7431 }, formatted_address: "Austin, TX" }],
      });
    }) as typeof fetch;

    const result = await geocodeAddress(fetchImpl, "test_key", {
      street: "123 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
    });

    expect(result).toEqual({ ok: true, status: 200, point: { lat: 30.2672, lng: -97.7431 } });
    expect(requestedUrl).toContain("https://api.geocod.io/v2/geocode?");
    expect(requestedUrl).toContain("api_key=test_key");
    expect(requestedUrl).toContain("limit=1");
    expect(decodeURIComponent(requestedUrl)).toContain("123 Main St, Austin, TX, 78701");
  });

  it("fails closed (never throws) on a non-2xx response", async () => {
    const fetchImpl = (async () => jsonResponse({ error: "invalid" }, 422)) as typeof fetch;
    const result = await geocodeAddress(fetchImpl, "test_key", { street: "nowhere" });
    expect(result).toEqual({ ok: false, status: 422 });
  });

  it("fails closed when the response has no usable location", async () => {
    const fetchImpl = (async () => jsonResponse({ results: [] })) as typeof fetch;
    const result = await geocodeAddress(fetchImpl, "test_key", { street: "123 Main St" });
    expect(result.ok).toBe(false);
  });

  it("fails closed rather than throwing on unparseable JSON", async () => {
    const fetchImpl = (async () => new Response("not json", { status: 200 })) as typeof fetch;
    const result = await geocodeAddress(fetchImpl, "test_key", { street: "123 Main St" });
    expect(result.ok).toBe(false);
  });
});
