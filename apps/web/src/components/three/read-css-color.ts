"use client";

const FALLBACK_RGB = "rgb(0, 0, 0)";

/**
 * Resolves a design-token CSS custom property (e.g. `--accent-500`) to
 * its browser-COMPUTED color, as an `rgb()`/`rgba()` string — regardless
 * of whether the token is declared as `oklch()`, `hsl()`, or a hex value
 * in `packages/ui/src/theme/globals.css`. Reading it through a real DOM
 * element's computed style (rather than parsing the raw custom-property
 * string ourselves, or trusting `THREE.Color`'s own CSS-string parsing)
 * is what keeps the WebGL/Canvas2D line's color synced to a token change
 * with zero duplicated color math and no risk of `three`'s parser
 * disagreeing with the browser's own OKLCH resolution
 * (WEBSITE_CREATIVE_BRIEF.md §7: "the WebGL line object's color reads
 * from the same --accent/--neutral tokens... via a small JS-side token
 * read at mount, not a hardcoded hex").
 */
export function readCssColor(customProperty: string, fallback = FALLBACK_RGB): string {
  if (typeof document === "undefined") return fallback;

  const probe = document.createElement("span");
  probe.style.color = `var(${customProperty})`;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();

  if (!resolved) return fallback;

  return toRgbString(resolved) ?? fallback;
}

/**
 * Current Chromium serializes a computed `color` value using whatever CSS
 * color function it was declared with — our design tokens (globals.css)
 * are `oklch()`, so `getComputedStyle` can hand back `oklch(...)` rather
 * than the `rgb()` this module used to assume. `THREE.Color`'s CSS-string
 * parser only understands `rgb()`/`hsl()`/hex, so rasterize the resolved
 * color through a 1x1 canvas — which does understand `oklch()` — and read
 * the actual pixel back as a plain `rgb()`/`rgba()` string. That sidesteps
 * however the browser chose to serialize the computed value, and degrades
 * to `null` (→ caller's fallback) in jsdom/SSR-like environments that
 * don't implement `CanvasRenderingContext2D`.
 */
function toRgbString(cssColor: string): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = cssColor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (r === undefined || g === undefined || b === undefined || a === undefined) return null;
    return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  } catch {
    return null;
  }
}
