import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseOklch } from "./contrast.js";

const CSS_PATH = join(dirname(fileURLToPath(import.meta.url)), "globals.css");
const css = readFileSync(CSS_PATH, "utf8");

/** Slices the body of the first `{...}` block whose opening matches `selector`. */
function extractBlock(selector: RegExp): string {
  const match = selector.exec(css);
  if (!match) throw new Error(`contrast.test: selector not found in globals.css: ${selector}`);
  let i = match.index + match[0].length;
  let depth = 1;
  const start = i;
  while (depth > 0 && i < css.length) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  return css.slice(start, i - 1);
}

function extractVar(block: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  const value = match?.[1];
  if (value === undefined) throw new Error(`contrast.test: --${name} not found in block`);
  return value.trim();
}

/** Like `extractVar`, but follows a one-level `var(--other-name)` alias
 * within the same block (e.g. `--primary-hover: var(--accent-600);`) down
 * to its literal `oklch(...)` value — the token these link-text call sites
 * actually resolve to at render time. */
function resolveVar(block: string, name: string): string {
  const value = extractVar(block, name);
  const aliasMatch = /^var\(--([\w-]+)\)$/.exec(value);
  return aliasMatch ? extractVar(block, aliasMatch[1] as string) : value;
}

// One entry per theme block in globals.css (base :root, the
// prefers-color-scheme dark override, and the explicit [data-theme="dark"]
// override) — all three ship real oklch() values for every status pair.
const THEMES: { name: string; selector: RegExp }[] = [
  { name: "light (:root)", selector: /:root\s*\{/ },
  {
    name: 'dark (prefers-color-scheme, :root:not([data-theme="light"]))',
    selector: /:root:not\(\[data-theme="light"\]\)\s*\{/,
  },
  { name: 'dark (:root[data-theme="dark"])', selector: /:root\[data-theme="dark"\]\s*\{/ },
];

// Status-pill pairs: a SOLID background paired with its foreground, as used
// by Badge's success/warning/destructive/info variants (and StatusBadge,
// which routes every enum value through those same Badge variants) —
// packages/ui/src/primitives/badge.tsx.
const PILL_PAIRS = ["success", "warning", "destructive", "info"];

const AA_NORMAL_TEXT = 4.5;

describe("status-pill token contrast (WCAG AA, badge.tsx variants)", () => {
  for (const theme of THEMES) {
    const block = extractBlock(theme.selector);

    for (const token of PILL_PAIRS) {
      it(`${theme.name}: ${token} background vs ${token}-foreground clears ${AA_NORMAL_TEXT}:1`, () => {
        const bg = parseOklch(extractVar(block, token));
        const fg = parseOklch(extractVar(block, `${token}-foreground`));
        const ratio = contrastRatio(bg, fg);
        expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      });
    }
  }
});

// `--primary` (accent-500) is used for large/bold UI (filled buttons,
// icons) where it clears AA-large's 3:1, but NOT for normal-weight text —
// as plain text-sized links on `--surface`/`--card` it measured as low as
// 3.42:1 (axe color-contrast, "serious"; round-final tenant review:
// call-detail transcript speaker label, customer/order-detail "Message"
// links, Button `link` variant). Those call sites were moved to
// `--primary-hover` (accent-600) instead — this guards that token pairing
// actually clears AA in both themes so a future accent re-tune can't
// silently regress it the same way.
describe("primary-hover-as-link-text contrast (WCAG AA, text-primary-hover call sites)", () => {
  for (const theme of THEMES) {
    const block = extractBlock(theme.selector);

    for (const surfaceToken of ["surface", "card"]) {
      it(`${theme.name}: primary-hover text vs ${surfaceToken} background clears ${AA_NORMAL_TEXT}:1`, () => {
        const fg = parseOklch(resolveVar(block, "primary-hover"));
        const bg = parseOklch(resolveVar(block, surfaceToken));
        const ratio = contrastRatio(bg, fg);
        expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      });
    }
  }
});
