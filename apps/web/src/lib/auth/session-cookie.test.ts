import { describe, expect, it } from "vitest";
import { hasSessionCookie } from "./session-cookie";

describe("hasSessionCookie", () => {
  it("detects the Supabase auth cookie, single or chunked", () => {
    expect(hasSessionCookie("a=1; sb-abcd-auth-token=base64-xyz; b=2")).toBe(true);
    expect(hasSessionCookie("sb-abcd-auth-token.0=part1; sb-abcd-auth-token.1=part2")).toBe(true);
  });

  it("ignores empty values, code verifiers and unrelated cookies", () => {
    expect(hasSessionCookie("")).toBe(false);
    expect(hasSessionCookie("theme=dark; heyloo_signup_draft=abc")).toBe(false);
    expect(hasSessionCookie("sb-abcd-auth-token=")).toBe(false);
    expect(hasSessionCookie("sb-abcd-auth-token-code-verifier=xyz")).toBe(false);
  });
});
