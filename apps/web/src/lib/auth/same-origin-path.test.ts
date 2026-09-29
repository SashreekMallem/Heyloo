import { describe, expect, it } from "vitest";
import { sameOriginPath } from "./same-origin-path";

const ORIGIN = "https://heyloo-voice.vercel.app";

describe("sameOriginPath", () => {
  it("keeps same-origin relative paths, query strings included", () => {
    expect(sameOriginPath("/signup/resume", ORIGIN)).toBe("/signup/resume");
    expect(sameOriginPath("/dashboard?tab=billing", ORIGIN)).toBe("/dashboard?tab=billing");
  });

  it.each([
    ["absolute URL", "https://evil.example/x"],
    ["protocol-relative", "//evil.example"],
    ["backslash host", "/\\evil.example"],
    ["tab-smuggled host", "/\t/evil.example"],
    ["newline-smuggled host", "/\n/evil.example"],
    ["javascript scheme", "javascript:alert(1)"],
    ["no leading slash", "evil.example"],
    ["empty", ""],
  ])("rejects %s", (_name, raw) => {
    expect(sameOriginPath(raw, ORIGIN)).toBeNull();
  });

  it("rejects null and undefined", () => {
    expect(sameOriginPath(null, ORIGIN)).toBeNull();
    expect(sameOriginPath(undefined, ORIGIN)).toBeNull();
  });
});
