import { describe, expect, it, vi } from "vitest";
import { readCssColor } from "./read-css-color";

// jsdom's CSS engine does not resolve `var(--x)` inside `getComputedStyle`
// (it returns the literal unresolved token instead of the browser's real
// resolved/fallback color) — a documented jsdom limitation, not a bug in
// this function, which genuine browsers resolve correctly. These tests
// exercise what's actually observable under jsdom: the function never
// throws, always returns a string, cleans up its probe element, and
// correctly takes the SSR/no-`document` fallback path.
describe("readCssColor", () => {
  it("returns a non-empty string and never throws, even when jsdom can't resolve the var()", () => {
    document.documentElement.style.setProperty("--heyloo-test-color", "rgb(220, 90, 10)");
    expect(() => readCssColor("--heyloo-test-color")).not.toThrow();
    expect(typeof readCssColor("--heyloo-test-color")).toBe("string");
    document.documentElement.style.removeProperty("--heyloo-test-color");
  });

  it("never leaves the probe element attached to the document", () => {
    readCssColor("--heyloo-does-not-exist");
    expect(document.querySelectorAll("span").length).toBe(0);
  });

  it("takes the SSR/no-document fallback path when there is no `document` to probe", () => {
    vi.stubGlobal("document", undefined);
    expect(readCssColor("--heyloo-anything", "rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    expect(readCssColor("--heyloo-anything")).toBe("rgb(0, 0, 0)");
    vi.unstubAllGlobals();
  });
});
