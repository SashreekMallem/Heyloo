import { cn } from "@heyloo/ui/lib/utils";
import type { CSSProperties } from "react";

/**
 * Zero-flash theme-correct `<img>`: renders BOTH the light and dark
 * source as identical markup on server and client (no attribute ever
 * differs between the two renders, so there's nothing for React to
 * mismatch on hydration), and lets pure CSS — evaluated by the browser
 * on the very first paint, exactly like `app/[locale]/layout.tsx`'s own
 * `data-theme`/`prefers-color-scheme` color tokens — decide which one is
 * actually visible. The alternative (deciding server-side which single
 * `<img>` to render) would need a theme COOKIE read during SSR, which is
 * out of this cluster's ownership; this achieves the same "correct on
 * first paint" guarantee without one.
 *
 * Used for `hero-film-scrubber.tsx`'s `poster.webp` (the hero's LCP
 * element) and for the reduced-motion/mobile tiers' `final.webp` — both
 * need to show the right theme's frame immediately, never a flash of the
 * wrong one while `use-resolved-theme.ts`'s client-only hook is still
 * settling.
 */

export interface HeroFilmThemeSrc {
  src: string;
  /** `srcSet` descriptor string, e.g. `"…/final-720.webp 720w, …/final.webp 1440w"`. */
  srcSet?: string;
}

export interface HeroFilmThemedImageProps {
  light: HeroFilmThemeSrc;
  dark: HeroFilmThemeSrc;
  alt: string;
  className?: string;
  sizes?: string;
  /** The hero film's authored frame size (1440×810) — explicit `width`/`height` so this never causes CLS regardless of which `srcSet` candidate the browser actually fetches. */
  width?: number;
  height?: number;
  /** LCP element — `poster.webp` needs `fetchPriority="high"` + eager loading; `final.webp` (reduced-motion/mobile tiers) does not. */
  priority?: boolean;
}

const THEME_IMG_CLASS = "hero-film-themed-img";

/**
 * GLUE+PERF finding (Playwright screenshot pass, `docs/BUILD_NOTES.md`):
 * this component's own inline `style` used to set `display: "block"` on
 * BOTH the light and dark `<img>` (every instance shares one `imgStyle`
 * object) — an inline style always wins over ANY stylesheet rule
 * regardless of selector specificity, `!important` aside, so the rules
 * below that were supposed to hide the non-active theme's image never
 * actually took effect. Both images rendered visible, stacked via
 * `absolute inset-0`, and since "dark" is the second `<img>` in DOM
 * order it painted on top of "light" every time — the reduced-motion and
 * mobile tiers (and the scrubber's own poster image, before its first
 * canvas frame decodes) showed the DARK backdrop regardless of resolved
 * theme, defeating this component's entire "zero-flash, theme-correct"
 * purpose. Fixed by moving `display` out of the inline style entirely —
 * it's controlled ONLY by these rules now — with an explicit default
 * (`.THEME_IMG_CLASS { display: none }` + `[data-heyloo-theme-img="light"]
 * { display: block }`) so "light" is the resolved default absent an
 * explicit dark theme/`prefers-color-scheme: dark`, matching every other
 * light/dark toggle in this codebase's own established
 * `:root:not([data-theme="light"])` dual-guard convention
 * (`packages/ui/theme/globals.css`).
 */
const THEME_IMG_CSS = `
  .${THEME_IMG_CLASS} { display: none; }
  .${THEME_IMG_CLASS}[data-heyloo-theme-img="light"] { display: block; }
  :root[data-theme="dark"] .${THEME_IMG_CLASS}[data-heyloo-theme-img="light"] { display: none; }
  :root[data-theme="dark"] .${THEME_IMG_CLASS}[data-heyloo-theme-img="dark"] { display: block; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) .${THEME_IMG_CLASS}[data-heyloo-theme-img="light"] { display: none; }
    :root:not([data-theme="light"]) .${THEME_IMG_CLASS}[data-heyloo-theme-img="dark"] { display: block; }
  }
`;

const imgStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

export function HeroFilmThemedImage({
  light,
  dark,
  alt,
  className,
  sizes,
  width = 1440,
  height = 810,
  priority,
}: HeroFilmThemedImageProps) {
  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, non-user-controlled CSS string (theme visibility rule shared by every instance). */}
      <style dangerouslySetInnerHTML={{ __html: THEME_IMG_CSS }} />
      {(
        [
          ["light", light],
          ["dark", dark],
        ] as const
      ).map(([themeName, themeSrc]) => (
        // biome-ignore lint/performance/noImgElement: both theme's <img> must always be present as plain, identical markup for the zero-flash CSS toggle to work (next/image's lazy loading and query-param rewriting would break that); sources are already pre-sized static assets, nothing to re-optimize.
        <img
          key={themeName}
          data-heyloo-theme-img={themeName}
          src={themeSrc.src}
          srcSet={themeSrc.srcSet}
          sizes={sizes}
          width={width}
          height={height}
          alt={alt}
          style={imgStyle}
          className={cn(THEME_IMG_CLASS, "absolute inset-0", className)}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding={priority ? "sync" : "async"}
        />
      ))}
    </>
  );
}
