// OUTBOUND-1 / SSRF-1 text pin: the outbound webhook entrypoints hand the
// global `fetch` to the delivery engine as `transport`, so their safety rests
// entirely on `delivery.ts` calling that transport ONLY through `safeFetch`
// (public https hosts, DNS answers checked, no redirects). The Deno
// entrypoints are excluded from tsc and unit tests, so this reads the sources
// as text (same approach as `../safe-fetch-call-sites.test.ts`) and fails if
// the transport ever escapes that wrapper.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const functionsDir = fileURLToPath(new URL("../..", import.meta.url));
const read = (rel: string) => readFileSync(`${functionsDir}${rel}`, "utf8");

/** Source without `//` line comments or block comments (prose mentions fetch). */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/[^\n"'`]*$/gm, "");
}

/** The text of the call starting at `open` (index of its `(`), parens balanced. */
function callSpan(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced call");
}

const count = (src: string, re: RegExp) => src.match(re)?.length ?? 0;

describe("outbound webhook transport only runs under safeFetch", () => {
  const delivery = code("_shared/outbound/delivery.ts");

  it("delivery.ts reads deps.transport once, as safeFetch's fetchImpl (status-only)", () => {
    expect(count(delivery, /\bdeps\.transport\b/g)).toBe(1);
    expect(count(delivery, /\bsafeFetch\(/g)).toBe(1);
    const safeFetchCall = callSpan(delivery, delivery.indexOf("safeFetch(") + "safeFetch".length);
    expect(safeFetchCall).toContain("fetchImpl: statusOnly(deps.transport ?? fetch)");
  });

  it("delivery.ts calls the transport only inside the statusOnly wrapper, and never fetch()", () => {
    // `function statusOnly(` + its single use inside the safeFetch options.
    expect(count(delivery, /\bstatusOnly\(/g)).toBe(2);
    expect(count(delivery, /\btransport\(/g)).toBe(1);
    const wrapperStart = delivery.indexOf("function statusOnly(");
    const wrapperEnd = delivery.indexOf("as typeof fetch;", wrapperStart);
    const callAt = delivery.search(/\btransport\(/);
    expect(callAt).toBeGreaterThan(wrapperStart);
    expect(callAt).toBeLessThan(wrapperEnd);
    expect(delivery).not.toMatch(/(?<![\w.])fetch\(/);
  });

  it.each([
    "_shared/outbound/payload.ts",
    "_shared/outbound/policy.ts",
    "_shared/outbound/secret.ts",
    "api-tenant-webhooks/handler.ts",
  ])("%s never fetches or touches the transport", (rel) => {
    const src = code(rel);
    expect(src).not.toMatch(/(?<![\w.])fetch\(/);
    expect(src).not.toMatch(/\btransport\b/);
  });

  it("api-tenant-webhooks/index.ts passes fetch only as the delivery transport", () => {
    const src = code("api-tenant-webhooks/index.ts");
    expect(src).toContain("transport: fetch }");
    expect(src).not.toMatch(/(?<![\w.])fetch\(/);
    expect(count(src, /\bfetch\b/g)).toBe(1);
  });

  it("worker-tick/index.ts passes fetch to the webhook leg only as its transport", () => {
    const src = code("worker-tick/index.ts");
    const start = src.indexOf("const OUTBOUND_WEBHOOK_DEPS: WebhookDeliveryDeps = {");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("};", start) + 2);
    expect(block).toContain("transport: fetch,");
    expect(count(block, /\bfetch\b/g)).toBe(1);
    expect(block).not.toMatch(/fetchImpl/);
  });
});
