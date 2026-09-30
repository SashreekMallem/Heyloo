import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS, securityHeaderRules } from "./security-headers";

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

function header(key: string): string | undefined {
  return SECURITY_HEADERS.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
}

describe("security headers (QA-1 F-08)", () => {
  it("applies a baseline to every route", () => {
    const rules = securityHeaderRules();
    expect(rules[0]?.source).toBe("/:path*");
  });

  it.each([
    "/login",
    "/dashboard",
    "/cockpit/tenants",
    "/portal",
    "/mfa/challenge",
    "/api/tenant/x",
  ])(
    "sets nosniff, referrer policy, permissions policy and anti-framing on %s (AUTH-13)",
    (path) => {
      const h = headersFor(path);
      expect(h["X-Content-Type-Options"]).toBe("nosniff");
      expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
      expect(h["Permissions-Policy"]).toContain("microphone=(self)");
      expect(h["X-Frame-Options"]).toBe("DENY");
      expect(h["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
    },
  );

  it("leaves the embeddable widget bundles out of the anti-framing rule (AUTH-13)", () => {
    for (const path of ["/widget.js", "/widget-voice.js"]) {
      const h = headersFor(path);
      expect(h["X-Frame-Options"]).toBeUndefined();
      expect(h["Content-Security-Policy"]).toBeUndefined();
      expect(h["X-Content-Type-Options"]).toBe("nosniff");
    }
  });

  it("sets the baseline hardening headers", () => {
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("Strict-Transport-Security")).toBe("max-age=31536000");
  });

  it("allows the microphone for this origin only (live demo + Test agent)", () => {
    const policy = header("Permissions-Policy") ?? "";
    expect(policy).toContain("microphone=(self)");
    expect(policy).toContain("camera=()");
  });

  it("ships a report-only CSP that forbids framing and plugins", () => {
    const csp = header("Content-Security-Policy-Report-Only") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("default-src 'self'");
    // Report-only first: the only ENFORCED CSP directive is anti-framing; a
    // full enforcing policy must not ship until the console has been clean for
    // a release.
    expect(header("Content-Security-Policy")).toBe("frame-ancestors 'none'");
  });
});
