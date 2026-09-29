import { describe, expect, it } from "vitest";
import { hasSupabaseSessionCookie } from "./session-cookie";

describe("hasSupabaseSessionCookie", () => {
  it("detects a single-cookie session", () => {
    expect(hasSupabaseSessionCookie("theme=dark; sb-abcdef-auth-token=base64-xyz")).toBe(true);
  });

  it("detects a chunked session cookie", () => {
    expect(hasSupabaseSessionCookie("sb-abcdef-auth-token.0=aaa; sb-abcdef-auth-token.1=bbb")).toBe(
      true,
    );
  });

  it("ignores unrelated cookies, the code-verifier cookie and empty values", () => {
    expect(hasSupabaseSessionCookie("")).toBe(false);
    expect(hasSupabaseSessionCookie("theme=dark; sidebar=1")).toBe(false);
    expect(hasSupabaseSessionCookie("sb-abcdef-auth-token-code-verifier=abc")).toBe(false);
    expect(hasSupabaseSessionCookie("sb-abcdef-auth-token=")).toBe(false);
  });
});
