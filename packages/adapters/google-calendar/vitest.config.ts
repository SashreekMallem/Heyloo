import { defineConfig } from "vitest/config";

// See packages/canonical-types/vitest.config.ts for why this exclude list
// exists: `tsc -b` emits compiled `.test.js` files into `dist/`, and without
// excluding it a per-package `vitest run` double-runs every test.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.turbo/**", "**/coverage/**"],
  },
});
