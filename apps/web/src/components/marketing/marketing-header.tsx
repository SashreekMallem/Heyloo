"use client";

import { Button } from "@heyloo/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { VERTICAL_CONTENT } from "@/content/marketing/verticals";
import { Link } from "@/i18n/navigation";

/** Header: logo, vertical dropdown, Pricing, Demo CTA, Login, Signup CTA (FRONTEND_SPEC.md §9.2). Collapses to a hamburger below `sm` (§3.1). */
export function MarketingHeader() {
  const t = useTranslations("Nav");
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-semibold">
          Heyloo
        </Link>

        <nav className="hidden items-center gap-6 text-sm md:flex">
          <div className="group relative">
            <button type="button" className="flex items-center gap-1 py-2">
              Verticals
            </button>
            <div className="invisible absolute left-0 top-full grid w-64 grid-cols-1 gap-1 rounded-md border border-border bg-popover p-2 opacity-0 shadow-md transition-opacity group-hover:visible group-hover:opacity-100">
              {VERTICAL_CONTENT.filter((v) => v.slug !== "generic").map((vertical) => (
                <Link
                  key={vertical.slug}
                  href={`/${vertical.slug}`}
                  className="rounded-sm px-2 py-1.5 hover:bg-secondary"
                >
                  {vertical.icon} {vertical.displayName}
                </Link>
              ))}
            </div>
          </div>
          <Link href="/pricing">{t("pricing")}</Link>
          <Link href="/demo">{t("demo")}</Link>
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button variant="ghost" asChild>
            <Link href="/login">{t("login")}</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">{t("signup")}</Link>
          </Button>
        </div>

        <button
          type="button"
          className="md:hidden"
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          <span className="block h-0.5 w-6 bg-foreground" />
          <span className="mt-1 block h-0.5 w-6 bg-foreground" />
          <span className="mt-1 block h-0.5 w-6 bg-foreground" />
        </button>
      </div>

      {open && (
        <nav className="flex flex-col gap-1 border-t border-border p-4 md:hidden">
          <Link href="/pricing" onClick={() => setOpen(false)}>
            {t("pricing")}
          </Link>
          <Link href="/demo" onClick={() => setOpen(false)}>
            {t("demo")}
          </Link>
          <Link href="/login" onClick={() => setOpen(false)}>
            {t("login")}
          </Link>
          <Link href="/signup" onClick={() => setOpen(false)}>
            {t("signup")}
          </Link>
        </nav>
      )}
    </header>
  );
}
