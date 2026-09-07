import { defineConfig } from "vitest/config";

// Root Vitest config using the `projects` field (the `workspace` file was
// deprecated in Vitest 3.2 and replaced by this — vitest.dev/guide/projects).
// Each package glob below is discovered by its own vitest.config.ts / test
// files; turbo's `test` task (turbo.json) invokes `pnpm -r test`, which runs
// `vitest run` per package, so this root config also lets a single
// `vitest run` at the repo root exercise every package in one process for
// local iteration.
export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
    // Exclude compiled output alongside the usual defaults — each package's
    // `build` runs before `test` (turbo dependsOn: ["^build"]), so without
    // this a package's own dist/**/*.test.js would otherwise be picked up
    // and run a second time next to its src/**/*.test.ts source.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.turbo/**", "**/coverage/**", "**/legacy/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
    },
  },
});
