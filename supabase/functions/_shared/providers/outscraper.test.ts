import { describe, expect, it, vi } from "vitest";
import {
  pollGoogleMapsResults,
  pollGoogleMapsReviews,
  startGoogleMapsReviews,
  startGoogleMapsSearch,
} from "./outscraper.ts";

function jsonRes(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("startGoogleMapsSearch", () => {
  it("captures place_id on each result row", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({ id: "req_1", data: [[{ name: "Joe's Diner", place_id: "ChIJ_joes" }]] }),
    ) as never;
    const result = await startGoogleMapsSearch(fetchImpl, "key", "diners", 10);
    expect(result.places?.[0]?.place_id).toBe("ChIJ_joes");
  });
});

describe("startGoogleMapsReviews", () => {
  it("requests /maps/reviews-v3 with the place id, reviewsLimit, and async=true", async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ id: "req_1", results_location: "https://x/r1" }));
    await startGoogleMapsReviews(fetchImpl as never, "key", ["ChIJ_joes"], 20);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/maps/reviews-v3");
    expect(url).toContain("query=ChIJ_joes");
    expect(url).toContain("reviewsLimit=20");
    expect(url).toContain("async=true");
    expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("key");
  });

  it("returns inline places when Outscraper answers synchronously despite async=true", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({
        id: "req_1",
        data: [
          [
            {
              google_id: "ChIJ_joes",
              reviews_data: [{ review_text: "Called three times, no answer.", review_rating: 1 }],
            },
          ],
        ],
      }),
    );
    const result = await startGoogleMapsReviews(fetchImpl as never, "key", ["ChIJ_joes"]);
    expect(result.ok).toBe(true);
    expect(result.places?.[0]?.reviews_data?.[0]?.review_text).toBe(
      "Called three times, no answer.",
    );
  });

  it("returns ok:false on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => jsonRes({}, false, 500));
    const result = await startGoogleMapsReviews(fetchImpl as never, "key", ["p1"]);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });
});

describe("pollGoogleMapsReviews", () => {
  it("treats status Completed as finished with data", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({
        status: "Completed",
        data: [[{ google_id: "p1", reviews_data: [{ review_text: "On hold forever." }] }]],
      }),
    );
    const result = await pollGoogleMapsReviews(fetchImpl as never, "key", "https://x/r1");
    expect(result.finished).toBe(true);
    expect(result.places[0]?.reviews_data?.[0]?.review_text).toBe("On hold forever.");
  });

  it("treats status Failed as finished with no data", async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ status: "Failed" }));
    const result = await pollGoogleMapsReviews(fetchImpl as never, "key", "https://x/r1");
    expect(result.finished).toBe(true);
    expect(result.places).toEqual([]);
  });

  it("treats status Running as not finished", async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ status: "Running" }));
    const result = await pollGoogleMapsReviews(fetchImpl as never, "key", "https://x/r1");
    expect(result.finished).toBe(false);
  });
});

// Sanity check the two poll functions stay behaviorally identical on the
// shared Completed/Failed/Running contract (both hit the same endpoint
// family) — a regression in one without the other would be easy to miss.
describe("pollGoogleMapsResults parity", () => {
  it("also treats Completed as finished", async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ status: "Completed", data: [[{ name: "x" }]] }));
    const result = await pollGoogleMapsResults(fetchImpl as never, "key", "https://x/r1");
    expect(result.finished).toBe(true);
  });
});
