import { describe, expect, it } from "vitest";
import { previewModeAliases } from "./src/lib/preview/preview-mode-aliases";

const MOCK_NAMES = ["require-tenant-session", "require-admin-session", "require-partner-session"];

describe("previewModeAliases (DESIGN-4)", () => {
  it("turbopack: aliases the @/lib/auth/<name> specifier to a config-relative mock path", () => {
    const aliases = previewModeAliases("turbopack");
    for (const name of MOCK_NAMES) {
      expect(aliases[`@/lib/auth/${name}`]).toBe(`./src/lib/preview/mocks/${name}.ts`);
    }
    // No absolute-source-path entries needed under Turbopack — its
    // resolveAlias is consulted against the pre-rewrite `@/...` specifier.
    expect(Object.keys(aliases)).toHaveLength(MOCK_NAMES.length);
  });

  it("webpack: ALSO aliases the real absolute source path, not just the @/... specifier", () => {
    // The bug this guards (DESIGN-4): Next's SWC compiler resolves this
    // repo's tsconfig `@/*` path mapping to a real on-disk import specifier
    // during transpilation, before webpack's `resolve.alias` ever sees the
    // original `@/lib/auth/<name>` string — so aliasing only that string
    // (as the turbopack branch correctly does for its own, different
    // resolution stage) is silently a no-op under webpack. A real
    // production `next build --webpack` with `UI_PREVIEW_MODE=1` then
    // executes the REAL, cookies()-throwing session helpers instead of the
    // fixture-backed mocks.
    const aliases = previewModeAliases("webpack");
    for (const name of MOCK_NAMES) {
      const specifierTarget = aliases[`@/lib/auth/${name}`];
      expect(specifierTarget).toBeDefined();
      expect(specifierTarget).toMatch(/\/src\/lib\/preview\/mocks\/.*\.ts$/);
      expect(specifierTarget?.startsWith("/")).toBe(true); // a real absolute path, not turbopack's relative form

      // The real fix: the RESOLVED absolute source path (what the
      // specifier above rewrites to before webpack resolves it) must
      // alias to that exact same mock target.
      const resolvedSourceKey = Object.keys(aliases).find((k) =>
        k.endsWith(`/src/lib/auth/${name}.ts`),
      );
      expect(resolvedSourceKey).toBeDefined();
      expect(aliases[resolvedSourceKey as string]).toBe(specifierTarget);
    }
  });
});
