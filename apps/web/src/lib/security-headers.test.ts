import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS, securityHeaderRules } from "./security-headers";

function header(key: string): string | undefined {
  return SECURITY_HEADERS.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
}

describe("security headers (QA-1 F-08)", () => {
  it("applies to every route", () => {
    const rules = securityHeaderRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe("/:path*");
  });

  it("sets the baseline hardening headers", () => {
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header("X-Frame-Options")).toBe("DENY");
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
    // Report-only first: an enforcing policy must not ship until the
    // console has been clean for a release.
    expect(header("Content-Security-Policy")).toBeUndefined();
  });
});
