import { defineConfig } from "vitest/config";

// Package-local config mirroring the root vitest.config.ts excludes. `tsc -b`
// (this package's `build` script) emits compiled `.test.js` files into
// `dist/` alongside `.d.ts` declarations; without this exclude, running
// `vitest run` FROM THIS PACKAGE (as turbo's per-package `test` task does)
// picks up both `src/**/*.test.ts` and the compiled `dist/**/*.test.js`,
// silently double-running every test. The root config already excludes
// `dist` for the "single `vitest run` at the repo root" case — this file
// gives the same protection to the per-package invocation.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.turbo/**", "**/coverage/**"],
  },
});
