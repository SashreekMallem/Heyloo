import { afterEach, describe, expect, it, vi } from "vitest";

/** Same real-filesystem approach as `../widget.js/route.test.ts` — see that
 * file's docstring. */

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("GET /widget-voice.js", () => {
  it("serves the real lazy voice-runtime bundle with a long cache", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("https://app.example/widget-voice.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(res.headers.get("cache-control")).toContain("max-age=3600");
    const body = await res.text();
    expect(body.length).toBeGreaterThan(1000); // the real bundle (retell-client-js-sdk included) is large
  });

  it("404s (never 500) when the bundle is missing", async () => {
    vi.spyOn(process, "cwd").mockReturnValue("/nonexistent-deploy-root");
    const { GET } = await import("./route");
    const res = await GET(new Request("https://app.example/widget-voice.js"));
    expect(res.status).toBe(404);
  });
});
