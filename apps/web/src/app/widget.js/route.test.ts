import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Deliberately exercises the REAL `node:fs/promises` against the real
 * built `packages/widget/dist/widget.global.js` (built earlier in this
 * same session's verification pass) rather than mocking the filesystem —
 * this route's entire job is "read this exact on-disk file and serve it
 * with the right headers", so reading the real file is the more faithful
 * test. The one thing that DOES need to vary between tests
 * (`process.cwd()`, which `route.ts`'s `DIST_PATH` is derived from) is
 * spied directly to point at a directory with no such file for the
 * missing-bundle case.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("GET /widget.js", () => {
  it("serves the real built bundle with a content-hash ETag and JS content type", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("https://app.example/widget.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(res.headers.get("etag")).toMatch(/^".+"$/);
    expect(res.headers.get("cache-control")).toContain("max-age=300");

    const expected = await readFile(
      path.join(process.cwd(), "..", "..", "packages", "widget", "dist", "widget.global.js"),
    );
    expect(await res.text()).toBe(expected.toString("utf-8"));
  });

  it("returns 304 when If-None-Match matches the current ETag", async () => {
    const { GET } = await import("./route");
    const first = await GET(new Request("https://app.example/widget.js"));
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await GET(
      new Request("https://app.example/widget.js", { headers: { "if-none-match": etag ?? "" } }),
    );
    expect(second.status).toBe(304);
  });

  it("returns a plain 404 (never a 500) when the bundle is missing from this deploy", async () => {
    vi.spyOn(process, "cwd").mockReturnValue("/nonexistent-deploy-root");
    const { GET } = await import("./route");
    const res = await GET(new Request("https://app.example/widget.js"));
    expect(res.status).toBe(404);
  });
});
