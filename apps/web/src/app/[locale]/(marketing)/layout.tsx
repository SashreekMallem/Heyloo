import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingHeader } from "@/components/marketing/marketing-header";

export const metadata: Metadata = {
  icons: { icon: "/favicon.svg" },
};

/**
 * (marketing) route group — no guard (FRONTEND_SPEC.md §0.1), header+footer
 * shell, no sidebar (§9.2).
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
    <div className="flex min-h-svh flex-col">
      <MarketingHeader />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
