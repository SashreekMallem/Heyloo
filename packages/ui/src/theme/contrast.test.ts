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

// `--accent-text` (DESIGN-4): the dedicated text/link accent token — every
// text/link call site that colors itself with the accent (`text-accent-text`)
// must resolve through this token, never bare `--primary`/`--accent-500`
// (which is only AA-safe for large/bold text, not normal weight — see the
// describe block above, which this one mirrors but against the token's own
// name rather than `--primary-hover`, since the two happen to share a value
// today but are conceptually independent — a future button-hover retune
// must not silently drag text contrast down with it).
describe("accent-text token contrast (WCAG AA, text-accent-text call sites)", () => {
  for (const theme of THEMES) {
    const block = extractBlock(theme.selector);

    for (const surfaceToken of ["background", "surface", "card"]) {
      it(`${theme.name}: accent-text vs ${surfaceToken} background clears ${AA_NORMAL_TEXT}:1`, () => {
        const fg = parseOklch(resolveVar(block, "accent-text"));
        const bg = parseOklch(resolveVar(block, surfaceToken));
        const ratio = contrastRatio(bg, fg);
        expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      });
    }
  }
});

// `--success`/`--destructive` used as plain TEXT color (`text-success`,
// `text-destructive` — e.g. `MetricCard`'s positive/negative delta,
// packages/ui/src/custom/metric-card.tsx), as distinct from the
// PILL_PAIRS describe block above which only covers them as a SOLID
// badge background paired with their own `-foreground` token. axe-core on
// the real built site flagged a "serious" violation for exactly this text
// usage (`text-success` on `--card`, home page's dashboard-preview
// MetricCards, SITE REPAIR review) even though this repo's own oklch math
// (contrast.ts) measured the pre-fix value at 5.16:1 — comfortably over
// AA's 4.5:1 — a reminder that this file's simplified per-channel gamut
// clamping isn't a perfect stand-in for a real browser's CSS Color 4
// gamut mapping, so token choices here should keep real margin, not sit
// right at the line. Guards `--success` (and, defensively, `--destructive`,
// which uses the same call-site pattern) against regressing back under AA
// as plain text on either everyday surface a metric/status text color
// might sit on.
describe("status text tokens as plain text (WCAG AA, text-success/text-destructive call sites)", () => {
  for (const theme of THEMES) {
    const block = extractBlock(theme.selector);

    for (const token of ["success", "destructive"]) {
      for (const surfaceToken of ["background", "card"]) {
        it(`${theme.name}: text-${token} vs ${surfaceToken} background clears ${AA_NORMAL_TEXT}:1`, () => {
          const fg = parseOklch(resolveVar(block, token));
          const bg = parseOklch(resolveVar(block, surfaceToken));
          const ratio = contrastRatio(bg, fg);
          expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        });
      }
    }
  }
});
