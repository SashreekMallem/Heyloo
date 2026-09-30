import "@/components/marketing/marketing.css";

import type { Metadata } from "next";
import { Geist_Mono, Mona_Sans } from "next/font/google";
import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { siteUrl } from "@/lib/marketing/site-url";

export const metadata: Metadata = {
  // Absolute base for every relative canonical / Open Graph URL below this
  // layout; without it Next falls back to localhost:3000 in the og:image tag.
  metadataBase: new URL(siteUrl()),
  icons: { icon: "/favicon.svg" },
  alternates: { types: { "application/rss+xml": "/rss.xml" } },
};

/**
 * The marketing type pairing (SITE-3, the approved premium design): Mona Sans
 * as a variable font with its width axis (`wdth` 75 to 125, plus `wght`), which
 * the kinetic headlines animate, and Geist Mono for labels, numbers and data.
 * Both are self-hosted at build time by `next/font/google` and only preloaded
 * on the marketing routes (this layout), never on the app or dashboard.
 * `src/components/marketing/marketing.css` reads the two CSS variables and
 * carries a size-adjusted local fallback face, so the swap never moves text.
 */
const monaSans = Mona_Sans({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-mona",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

/**
 * (marketing) route group — no guard (FRONTEND_SPEC.md §0.1), header+footer
 * shell, no sidebar (§9.2). `.mk` is the shell class: it carries the new
 * palette tokens (dark by default, light by system preference or an explicit
 * `data-theme`), the two font variables, and remaps the app's semantic colour
 * tokens so the pages that keep the app's components wear the same look.
 *
 * `setRequestLocale` must run here (not just in the parent `[locale]`
 * layout) because Next.js can render nested layouts/pages independently
 * during static generation — each file-based segment that touches a
 * next-intl API (directly, or via `MarketingFooter`'s `useTranslations`)
 * needs its own call before that API runs, or that segment falls back to
 * reading the locale from `headers()` and opts the whole route into
 * dynamic rendering (VERIFY per next-intl 4.x docs, egress-blocked in this
 * environment — confirmed instead against the installed package's
 * `next-intl/dist/esm/.../RequestLocale.js` source, which throws the exact
 * "opts into dynamic rendering" error when `setRequestLocale` wasn't called
 * first; see docs/VERIFY.md).
 */
export default async function MarketingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className={`mk ${monaSans.variable} ${geistMono.variable} flex min-h-svh flex-col`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <MarketingHeader />
      <main id="main" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
