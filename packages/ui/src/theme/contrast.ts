/**
 * WCAG contrast-ratio math for our OKLCH design tokens (globals.css).
 * Used by contrast.test.ts to assert the status-pill token pairs
 * (Badge `success`/`warning`/`destructive`/`info` variants, StatusBadge)
 * clear AA's 4.5:1 for normal text in both themes — see round-5 tenant
 * design review, blocker on the light-theme warning badge (2.93:1).
 *
 * Conversion follows Björn Ottosson's reference OKLab/OKLCH <-> linear
 * sRGB formulas (bottosson.github.io/posts/oklab) — the same math browsers
 * use to resolve `oklch()` CSS values, so this mirrors what a real render
 * (and axe-core) sees.
 */

export type Rgb = readonly [number, number, number];

function oklchToOklab(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  return [l, c * Math.cos(h), c * Math.sin(h)];
}

function oklabToLinearSrgb(l: number, a: number, b: number): [number, number, number] {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const ll = l_ ** 3;
  const mm = m_ ** 3;
  const ss = s_ ** 3;
  return [
    4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss,
    -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss,
    -0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss,
  ];
}

function linearToSrgb(x: number): number {
  const clamped = Math.min(Math.max(x, 0), 1);
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

/** `oklch(L C H)` (0-1 lightness, chroma, hue in degrees) -> 8-bit sRGB. */
export function oklchToSrgb(l: number, c: number, hDeg: number): Rgb {
  const [ol, a, b] = oklchToOklab(l, c, hDeg);
  const [r, g, bb] = oklabToLinearSrgb(ol, a, b);
  return [r, g, bb].map((v) => Math.round(linearToSrgb(v) * 255)) as unknown as Rgb;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const f = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 2.x contrast ratio (1-21) between two sRGB colors. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Parses a bare `oklch(L C H)` token value (no alpha) into its 8-bit sRGB. */
export function parseOklch(value: string): Rgb {
  const match = value.trim().match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!match) {
    throw new Error(`parseOklch: unrecognized oklch() value: "${value}"`);
  }
  const [, l, c, h] = match;
  return oklchToSrgb(Number(l), Number(c), Number(h));
}
