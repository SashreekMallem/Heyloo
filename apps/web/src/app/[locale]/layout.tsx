import "../globals.css";

import { Fraunces, IBM_Plex_Mono, Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { routing } from "@/i18n/routing";
import { Providers } from "../providers";

/**
 * Type pairing (docs/DESIGN_SYSTEM.md §Typography): Fraunces — a
 * characterful, high-contrast display serif with optical sizing — for
 * headlines, paired with Inter — a highly legible UI/body face with a real
 * tabular-figure variant — for body copy and data, plus IBM Plex Mono for
 * phone numbers, ids, and code. All three are self-hosted at build time by
 * `next/font/google` (zero runtime request, no layout shift — CLAUDE.md
 * Rule 1.1: fetched and verified reachable from this environment against
 * fonts.googleapis.com; `display: "swap"` plus each font's `adjustFontFallback`
 * default (on, matches a system font's metrics to the size Fraunces/Inter
 * would occupy) keeps a swap from ever shifting layout). Each font exports
 * a CSS variable consumed by packages/ui's `--font-display`/`--font-sans`/
 * `--font-mono` tokens (packages/ui/src/theme/globals.css) — that file's
 * `var()` chains also carry a curated system-stack fallback as the tail,
 * so if these variables are ever unset (e.g. a font fetch failure in some
 * future environment — see docs/VERIFY.md) the app still renders in a
 * solid system-font stack rather than the browser default serif.
 */
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["opsz"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Inline, dependency-free theme bootstrap (no next-themes — apps/web's
 * package.json isn't in this task's ownership). Runs synchronously before
 * first paint to set `data-theme` from the viewer's stored preference, so
 * there's no flash of the wrong theme; an unset preference leaves the
 * attribute off entirely and `prefers-color-scheme` in
 * packages/ui/src/theme/globals.css decides. `<ThemeToggle>` (@heyloo/ui)
 * writes the same `localStorage` key.
 */
const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem("heyloo-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${fraunces.variable} ${inter.variable} ${ibmPlexMono.variable}`}
    >
      <head>
        {/*
         * Tells the browser's own UA chrome (scrollbars, form controls,
         * the mobile status-bar/pull-to-refresh background) that BOTH
         * themes are supported and to pick one immediately from
         * `prefers-color-scheme` — this paints correctly on the very
         * first frame, before the bootstrap script below even runs,
         * instead of a light-UA-chrome flash under a dark system theme
         * (docs/DESIGN_SYSTEM.md's "system preference via
         * prefers-color-scheme, default — no toggle needed").
         */}
        <meta name="color-scheme" content="light dark" />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, non-user-controlled bootstrap script — see comment above. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
