import { defineConfig } from "tsup";

/**
 * Two independent, self-executing IIFE bundles (ownership brief: "built
 * with tsup/esbuild to a single ES5-safe IIFE"):
 *   - `widget.js` (from `src/index.ts`) — the always-loaded main script,
 *     kept under the <25KB gz budget (`scripts/check-size.mjs`, run in CI
 *     via `pnpm --filter @heyloo/widget size`).
 *   - `voice-runtime.js` (from `src/voice-runtime.ts`) — bundles
 *     `retell-client-js-sdk`, lazy-loaded by `voice-bridge.ts` only when a
 *     visitor opens Voice mode, so its weight never counts against the
 *     main script's budget.
 * Neither entry has an `export` statement (both are pure side-effect
 * scripts), so no `globalName` is needed for the `iife` format.
 * `target: "es5"` — esbuild lowers `let`/`const`/arrow functions/optional
 * chaining/nullish coalescing/classes to ES5-safe syntax; `async`/`await`
 * and generators are NOT lowerable to ES5 by esbuild at all (the build
 * fails loudly instead), which is exactly why `src/**` never uses them
 * (see `src/api.ts`'s docstring).
 */
export default defineConfig({
  entry: { widget: "src/index.ts", "voice-runtime": "src/voice-runtime.ts" },
  format: ["iife"],
  target: "es5",
  platform: "browser",
  minify: true,
  sourcemap: false,
  clean: true,
  outDir: "dist",
  splitting: false,
  dts: false,
  treeshake: true,
  legacyOutput: false,
});
