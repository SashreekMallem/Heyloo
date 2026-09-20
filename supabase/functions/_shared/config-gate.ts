/**
 * Pure "is this optional integration configured" predicate (OPS-5,
 * docs/BUILD_NOTES.md). Lives outside `_shared/deno/**` deliberately —
 * that directory is excluded from `tsconfig.json`/vitest entirely (Deno-
 * only glue), so a check this security-relevant (a webhook function
 * failing CLOSED when its signing secret is unset) would otherwise have
 * zero unit-test coverage. This file touches no `Deno` global, so it is
 * typechecked and unit-tested here under Node/vitest exactly like every
 * other business-logic file under `_shared/`, and each webhook/worker
 * `index.ts` in this task imports it directly to gate its `Deno.serve`
 * handler — same predicate in both places, not a parallel reimplementation.
 */

/** Names, among `vars`, whose value is missing/empty (mirrors
 * `_shared/deno/env.ts`'s `missingEnv` falsy check exactly, so the two
 * never disagree about what counts as "unset"). */
export function missingConfig(vars: Record<string, string | undefined>): string[] {
  return Object.entries(vars)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

/** True when every named var in `vars` has a non-empty value. */
export function isConfigured(vars: Record<string, string | undefined>): boolean {
  return missingConfig(vars).length === 0;
}
