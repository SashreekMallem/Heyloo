import { fileURLToPath } from "node:url";

/**
 * UI Preview Mode's build-time module aliasing (docs/DESIGN_SYSTEM.md §UI
 * Preview Mode, `apps/web/next.config.ts`) — split into its own
 * dependency-free module (no `@sentry/nextjs`/`next-intl` imports, unlike
 * `next.config.ts` itself) so `next.config.test.ts` can import and unit-test
 * the alias table directly without triggering those packages' import-time
 * side effects (confirmed: importing `next.config.ts` directly under
 * Vitest throws inside `@sentry/server-utils`' bundler-plugin resolution,
 * unrelated to anything this module needs to verify — DESIGN-4).
 */
export const PREVIEW_MODE_MOCK_NAMES = [
  "require-tenant-session",
  "require-admin-session",
  "require-partner-session",
] as const;

/**
 * Real per-`kind` alias table for the 3 auth-session mocks.
 *
 * Turbopack's `resolveAlias` and webpack's `resolve.alias` want the alias
 * TARGET in different forms (confirmed by running `UI_PREVIEW_MODE=1 next
 * dev` against this exact config): Turbopack wants a plain path relative to
 * `next.config.ts` (a leading `/` is treated as an unsupported
 * "server-relative" import and rejected); webpack wants a real absolute
 * filesystem path.
 *
 * webpack ALSO needs a second alias entry per mock, keyed by the real
 * absolute SOURCE path (`src/lib/auth/<name>.ts`), not just the `@/lib/
 * auth/<name>` specifier: this repo's tsconfig `paths` maps `@/*` to
 * `./src/*`, and Next's SWC compiler resolves that mapping to a real,
 * on-disk relative import specifier DURING transpilation — before
 * webpack's own module resolution (and thus a `@/lib/auth/<name>`-keyed
 * alias) ever sees the original `@/...` specifier at all. That rewrite is
 * invisible to Turbopack (its `resolveAlias` is consulted against the
 * pre-rewrite specifier, which is why the single alias entry works there)
 * but means a webpack alias keyed only on the `@/...` string is silently a
 * no-op for every real import site — confirmed by instrumenting this
 * function during a real `next build --webpack UI_PREVIEW_MODE=1`: the
 * alias table it received was exactly correct, but every `(tenant)`/
 * `(admin)`/`(partner)` page still executed the REAL, cookies()-throwing
 * `src/lib/auth/<name>.ts`, never the mock — and a genuine
 * production-shaped build+start of UI Preview Mode rendered/crashed
 * incorrectly as a result (docs/BUILD_NOTES.md DESIGN-4). Aliasing the
 * already-resolved real absolute source path too — the form webpack's
 * resolver actually receives post-rewrite — makes the substitution land.
 */
export function previewModeAliases(kind: "turbopack" | "webpack"): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const name of PREVIEW_MODE_MOCK_NAMES) {
    if (kind === "turbopack") {
      aliases[`@/lib/auth/${name}`] = `./src/lib/preview/mocks/${name}.ts`;
      continue;
    }
    const mockTarget = fileURLToPath(new URL(`./mocks/${name}.ts`, import.meta.url));
    aliases[`@/lib/auth/${name}`] = mockTarget;
    aliases[fileURLToPath(new URL(`../auth/${name}.ts`, import.meta.url))] = mockTarget;
  }
  return aliases;
}
