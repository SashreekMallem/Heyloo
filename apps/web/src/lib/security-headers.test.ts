import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { securityHeaderRules } from "./security-headers";

// Next's own matcher (the same one `headers()` sources are compiled with).
const { pathToRegexp } = createRequire(import.meta.url)("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (source: string) => RegExp;
};

function headersFor(pathname: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of securityHeaderRules()) {
    if (pathToRegexp(rule.source).test(pathname)) {
      for (const { key, value } of rule.headers) out[key] = value;
    }
  }
  return out;
}

describe("securityHeaderRules (AUTH-13)", () => {
  it.each([
    "/login",
    "/dashboard",
    "/cockpit/tenants",
    "/portal",
    "/mfa/challenge",
    "/api/tenant/x",
  ])("sets nosniff, referrer policy, permissions policy and anti-framing on %s", (path) => {
    const h = headersFor(path);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toContain("microphone=(self)");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
  });

  it("leaves the embeddable widget bundles out of the anti-framing rule", () => {
    for (const path of ["/widget.js", "/widget-voice.js"]) {
      const h = headersFor(path);
      expect(h["X-Frame-Options"]).toBeUndefined();
      expect(h["Content-Security-Policy"]).toBeUndefined();
      expect(h["X-Content-Type-Options"]).toBe("nosniff");
    }
  });
});
