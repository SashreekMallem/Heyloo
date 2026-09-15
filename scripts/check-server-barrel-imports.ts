#!/usr/bin/env node
/**
 * Guards against reintroducing the marketing-home-route regression fixed
 * in commit d532ed3 (see CLUSTER BARREL-SWEEP task notes / docs/BUILD_NOTES.md):
 * a Server Component (any `.ts`/`.tsx` file under `apps/web/src` with no
 * `"use client"` directive) that imports from the `@heyloo/ui` barrel
 * causes Next's client-reference tracing to register every reachable
 * "use client" module (Radix, react-hook-form, @tanstack/table-core, zod,
 * recharts, cmdk, react-day-picker, ...) as a client dependency of that
 * page — even when the page renders none of them. Measured cost: 379KB gz
 * of dead weight on the marketing home route before the fix.
 *
 * Client components ("use client") are unaffected: their imports are
 * tree-shaken correctly by the bundler, so barrel imports are fine there.
 *
 * This scans for the bare `@heyloo/ui` barrel AND the `@heyloo/ui/primitives`
 * / `@heyloo/ui/custom` index barrels (same problem, one level down) in any
 * Server Component. Dependency-free (`scripts/` is not a pnpm workspace
 * member — same constraint as `scripts/ci/*.ts` and `scripts/site-perf/
 * measure.ts` — plain `node:*` builtins only), erasable-TypeScript syntax
 * only.
 *
 * Run: `node --experimental-strip-types scripts/check-server-barrel-imports.ts`
 * (also wired as `pnpm run check:server-barrels` and a CI step, see
 * package.json / .github/workflows/ci.yml).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC_DIR = join(ROOT, "apps/web/src");

// Matches a bare `@heyloo/ui` import/export specifier, or the
// `@heyloo/ui/primitives` / `@heyloo/ui/custom` index barrels — but NOT a
// real deep subpath like `@heyloo/ui/primitives/button` or
// `@heyloo/ui/custom/metric-card` (those are the fix, not the problem).
const BARREL_SPECIFIER_RE =
  /from\s+["'](@heyloo\/ui|@heyloo\/ui\/primitives|@heyloo\/ui\/custom)["']/g;

const USE_CLIENT_RE = /^\s*["']use client["']\s*;?\s*$/m;

interface Violation {
  file: string;
  specifiers: string[];
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

function isServerFile(source: string): boolean {
  // A directive must be the first real statement in the file (leading
  // comments/whitespace aside) to count per Next's convention, but for
  // this guard's purposes a simple "does the string appear anywhere in
  // the first non-comment line-ish region" check is intentionally
  // generous — false negatives (missing a violation) are the risky
  // failure mode here, not false positives, so we scan the whole file.
  return !USE_CLIENT_RE.test(source);
}

function findViolations(): Violation[] {
  const files = walk(SRC_DIR, []);
  const violations: Violation[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf-8");
    if (!isServerFile(source)) continue;

    const matches = [...source.matchAll(BARREL_SPECIFIER_RE)];
    if (matches.length === 0) continue;

    const specifiers = [...new Set(matches.map((m) => m[1]))];
    violations.push({ file: relative(ROOT, file), specifiers });
  }

  return violations.sort((a, b) => a.file.localeCompare(b.file));
}

const violations = findViolations();

if (violations.length > 0) {
  console.error(
    `check-server-barrel-imports: ${violations.length} Server Component file(s) import a ` +
      `@heyloo/ui barrel, which leaks every reachable "use client" module (Radix, ` +
      `react-hook-form, table-core, zod, ...) into that page's client bundle.\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    imports: ${v.specifiers.join(", ")}`);
  }
  console.error(
    "\nFix: replace the barrel import with deep imports resolved to each export's " +
      "defining module, e.g.\n" +
      '  import { Button } from "@heyloo/ui";\n' +
      "becomes\n" +
      '  import { Button } from "@heyloo/ui/primitives/button";\n' +
      "Verify each export's module by checking packages/ui/src/**/index.ts re-export " +
      "lists (primitives/*, layout/*, custom/*, icons, lib/*, motion-tokens) — never guess " +
      "a path. Charts/command/date-range/input-otp/notification/audio-player already have " +
      "dedicated subpaths (@heyloo/ui/charts, @heyloo/ui/command, etc.) — use them.\n" +
      'Client components (files starting with "use client") are exempt: their imports ' +
      "are tree-shaken correctly and may keep barrel imports.",
  );
  process.exit(1);
}

console.log(
  `check-server-barrel-imports: OK (scanned apps/web/src, no Server Component imports a @heyloo/ui barrel)`,
);
