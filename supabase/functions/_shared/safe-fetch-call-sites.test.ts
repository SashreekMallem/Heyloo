// SSRF-1 guard: the Deno entrypoints are excluded from tsc and unit tests, so
// this reads them as text and pins that every place that fetches a URL supplied
// by a user, tenant, lead record or provider payload goes through safe-fetch.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const functionsDir = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(`${functionsDir}${rel}`, "utf8");

describe("SSRF-1 call sites use safe-fetch", () => {
  it.each([
    "api-menu-import/index.ts",
    "api-demo-agent/index.ts",
    "job-outreach-personalize/index.ts",
    "worker-recording-fetch/index.ts",
    "worker-tick/index.ts",
    "api-adapter-connect/index.ts",
    "worker-adapter-push/index.ts",
  ])("%s imports the safe fetch", (rel) => {
    expect(read(rel)).toContain('"../_shared/safe-fetch.ts"');
  });

  it.each([
    "api-menu-import/index.ts",
    "api-demo-agent/index.ts",
    "job-outreach-personalize/index.ts",
    "worker-recording-fetch/index.ts",
    "worker-tick/index.ts",
  ])("%s has no bare fetch() of a caller-supplied url", (rel) => {
    expect(read(rel)).not.toMatch(/\bfetch\(\s*url\b/);
  });

  it.each(["api-adapter-connect/index.ts", "worker-adapter-push/index.ts", "worker-tick/index.ts"])(
    "%s passes the safe fetch, not the global fetch, to the adapters",
    (rel) => {
      const src = read(rel);
      expect(src).toContain("fetchImpl: ADAPTER_FETCH");
      expect(src).not.toMatch(/\bfetchImpl:\s*fetch\b/);
    },
  );
});
