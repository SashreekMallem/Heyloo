// ESLint flat config for `apps/web` ONLY (MASTER_SPEC.md §2 — Biome stays
// the root linter/formatter; this adds the Next.js/security/testing-library
// plugin coverage Biome doesn't have). Never applied to any other package —
// import this from `apps/web/eslint.config.mjs` alone.
import nextFlatConfig from "eslint-config-next";
import securityPlugin from "eslint-plugin-security";
import testingLibraryPlugin from "eslint-plugin-testing-library";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [
      ".next/**",
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
    ],
  },
  ...nextFlatConfig,
  securityPlugin.configs.recommended,
  {
    rules: {
      // Next.js Route Handlers/edge middleware read secrets from
      // process.env directly — this is expected, not a vulnerability.
      "security/detect-object-injection": "off",
      "security/detect-non-literal-fs-filename": "off",
    },
  },
  {
    // `.spec.ts` here means Playwright (tests/e2e/**), not
    // @testing-library/react — its `getByRole`/`getByText` calls are
    // Playwright's own Locator API, not a `render()` result to discourage
    // destructuring from, so the testing-library plugin below excludes it.
    files: ["**/*.test.{ts,tsx}"],
    ignores: ["tests/e2e/**"],
    plugins: { "testing-library": testingLibraryPlugin },
    rules: {
      ...testingLibraryPlugin.configs["flat/react"].rules,
    },
  },
];
