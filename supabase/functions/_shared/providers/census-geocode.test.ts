import { describe, expect, it } from "vitest";
import {
  CENSUS_MAX_ADDRESS_CHARS,
  type CensusFetch,
  geocodeOneLine,
  oneLineAddress,
} from "./census-geocode.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The body the live geocoder returned on 2026-10-01 for this address. */
const RICHARDSON = {
  result: {
    input: { address: { address: "400 N Greenville Ave, Richardson, TX 75081" } },
    addressMatches: [
      {
        tigerLine: { side: "R", tigerLineId: "103254217" },
        coordinates: { x: -96.728621302589, y: 32.953692217245 },
        addressComponents: {
          zip: "75081",
          streetName: "GREENVILLE",
          preType: "",
          city: "RICHARDSON",
          preDirection: "N",
          suffixDirection: "",
          fromAddress: "400",
          state: "TX",
          suffixType: "AVE",
          toAddress: "498",
          suffixQualifier: "",
          preQualifier: "",
        },
        matchedAddress: "400 N GREENVILLE AVE, RICHARDSON, TX, 75081",
      },
    ],
  },
};

describe("geocodeOneLine", () => {
  it("returns the first match with lat = y, lng = x and the street line of matchedAddress", async () => {
    let requested = "";
    const fetchImpl: CensusFetch = async (url) => {
      requested = url;
      return jsonResponse(RICHARDSON);
    };
    const result = await geocodeOneLine(fetchImpl, "400 N Greenville Ave, Richardson, TX 75081");
    expect(result).toEqual({
      ok: true,
      match: {
        matchedAddress: "400 N GREENVILLE AVE, RICHARDSON, TX, 75081",
        lat: 32.953692217245,
        lng: -96.728621302589,
        street: "400 N GREENVILLE AVE",
        city: "RICHARDSON",
        state: "TX",
        zip: "75081",
      },
    });
    expect(requested).toContain(
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=",
    );
    expect(requested).toContain("benchmark=Public_AR_Current");
    expect(requested).toContain("format=json");
    expect(new URL(requested).searchParams.get("address")).toBe(
      "400 N Greenville Ave, Richardson, TX 75081",
    );
  });

  it("returns match: null when nothing matched", async () => {
    const fetchImpl: CensusFetch = async () =>
      jsonResponse({ result: { input: {}, addressMatches: [] } });
    expect(await geocodeOneLine(fetchImpl, "zzzz")).toEqual({ ok: true, match: null });
  });

  it("returns match: null for a blank address without calling the geocoder", async () => {
    let called = false;
    const fetchImpl: CensusFetch = async () => {
      called = true;
      return jsonResponse(RICHARDSON);
    };
    expect(await geocodeOneLine(fetchImpl, "   ")).toEqual({ ok: true, match: null });
    expect(called).toBe(false);
  });

  it("caps the address at the geocoder's 100-character limit", async () => {
    let requested = "";
    const fetchImpl: CensusFetch = async (url) => {
      requested = url;
      return jsonResponse({ result: { addressMatches: [] } });
    };
    await geocodeOneLine(fetchImpl, `1 ${"Very Long Street Name ".repeat(10)}`);
    expect(new URL(requested).searchParams.get("address")?.length).toBe(CENSUS_MAX_ADDRESS_CHARS);
  });

  it("http_error on a non-2xx answer", async () => {
    const fetchImpl: CensusFetch = async () =>
      jsonResponse({ errors: ["Address cannot be empty"], status: "400" }, 400);
    expect(await geocodeOneLine(fetchImpl, "1 Main St")).toEqual({
      ok: false,
      reason: "http_error",
    });
  });

  it("http_error when fetch itself rejects", async () => {
    const fetchImpl: CensusFetch = async () => {
      throw new TypeError("network down");
    };
    expect(await geocodeOneLine(fetchImpl, "1 Main St")).toEqual({
      ok: false,
      reason: "http_error",
    });
  });

  it("bad_response on an unexpected body or non-JSON", async () => {
    const shapes: Response[] = [
      jsonResponse({ results: [] }),
      jsonResponse({ result: { addressMatches: [{ matchedAddress: "X" }] } }),
      jsonResponse({
        result: { addressMatches: [{ matchedAddress: "X", coordinates: { x: "a", y: 1 } }] },
      }),
      new Response("<html>oops</html>", { status: 200 }),
    ];
    for (const res of shapes) {
      const fetchImpl: CensusFetch = async () => res;
      expect(await geocodeOneLine(fetchImpl, "1 Main St")).toEqual({
        ok: false,
        reason: "bad_response",
      });
    }
  });

  it("times out (aborts the request) after timeoutMs", async () => {
    let signal: AbortSignal | null | undefined;
    const fetchImpl: CensusFetch = (_url, init) => {
      signal = init?.signal;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    };
    const started = Date.now();
    const result = await geocodeOneLine(fetchImpl, "1 Main St", { timeoutMs: 20 });
    expect(result).toEqual({ ok: false, reason: "timeout" });
    expect(signal?.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("omits blank components", async () => {
    const fetchImpl: CensusFetch = async () =>
      jsonResponse({
        result: {
          addressMatches: [
            {
              matchedAddress: "1 MAIN ST, X, TX, 75001",
              coordinates: { x: -96, y: 32 },
              addressComponents: { city: "", state: "TX", zip: "" },
            },
          ],
        },
      });
    const result = await geocodeOneLine(fetchImpl, "1 Main St");
    expect(result).toEqual({
      ok: true,
      match: {
        matchedAddress: "1 MAIN ST, X, TX, 75001",
        lat: 32,
        lng: -96,
        street: "1 MAIN ST",
        state: "TX",
      },
    });
  });
});

describe("oneLineAddress", () => {
  it("joins street, city and 'state zip', skipping blanks and collapsing whitespace", () => {
    expect(
      oneLineAddress({
        street: " 400  N Greenville Ave ",
        city: "Richardson",
        state: "TX",
        zip: "75081",
      }),
    ).toBe("400 N Greenville Ave, Richardson, TX 75081");
    expect(oneLineAddress({ street: "1 Main St", zip: "75081" })).toBe("1 Main St, 75081");
    expect(oneLineAddress({ street: "1 Main St", city: null, state: "", zip: undefined })).toBe(
      "1 Main St",
    );
  });
});
