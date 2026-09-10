"use client";

import { Button, Container, ThemeToggle, VerticalIcon } from "@heyloo/ui";
import { ChevronDown, Menu, Phone, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { VERTICAL_CONTENT } from "@/content/marketing/verticals";
import { Link } from "@/i18n/navigation";

/** Header: logo, vertical dropdown, Pricing, Demo CTA, Login, Signup CTA (FRONTEND_SPEC.md §9.2). Collapses to a hamburger below `md` (§3.1). */
export function MarketingHeader() {
  const t = useTranslations("Nav");
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-(--z-sticky) border-b border-border bg-background/90 backdrop-blur">
      <Container size="wide">
        <div className="flex h-16 items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Phone className="size-4" aria-hidden="true" />
            </span>
            <span className="font-display text-h4 font-semibold">Heyloo</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            <div className="group relative">
              <button
                type="button"
                className="flex items-center gap-1 rounded-md px-3 py-2 text-small font-medium text-foreground/80 transition-colors duration-(--duration-fast) hover:bg-secondary hover:text-foreground"
              >
                Business types
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </button>
              <div className="invisible absolute left-0 top-full grid w-72 grid-cols-1 gap-0.5 rounded-lg border border-border bg-popover p-2 opacity-0 shadow-lg transition-[opacity,visibility] duration-(--duration-fast) ease-(--ease-out) group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                {VERTICAL_CONTENT.filter((v) => v.slug !== "generic").map((vertical) => (
                  <Link
                    key={vertical.slug}
                    href={`/${vertical.slug}`}
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-small text-popover-foreground transition-colors hover:bg-secondary"
                  >
                    <VerticalIcon
                      vertical={vertical.vertical}
                      className="size-4 text-muted-foreground"
                    />
                    {vertical.displayName}
                  </Link>
                ))}
              </div>
            </div>
            <Link
              href="/pricing"
              className="rounded-md px-3 py-2 text-small font-medium text-foreground/80 transition-colors duration-(--duration-fast) hover:bg-secondary hover:text-foreground"
            >
              {t("pricing")}
            </Link>
            <Link
              href="/demo"
              className="rounded-md px-3 py-2 text-small font-medium text-foreground/80 transition-colors duration-(--duration-fast) hover:bg-secondary hover:text-foreground"
            >
              {t("demo")}
            </Link>
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <ThemeToggle />
            <Button variant="ghost" asChild>
              <Link href="/login">{t("login")}</Link>
            </Button>
            <Button asChild>
              <Link href="/signup">{t("signup")}</Link>
            </Button>
          </div>

          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-md text-foreground md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-label="Toggle menu"
            aria-expanded={open}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </Container>

      {open && (
        <nav
          aria-label="Primary"
          className="flex flex-col gap-1 border-t border-border bg-background px-4 py-4 md:hidden"
        >
          <p className="px-3 pb-1 pt-2 text-micro font-medium uppercase tracking-wide text-muted-foreground">
            Business types
          </p>
          {VERTICAL_CONTENT.filter((v) => v.slug !== "generic").map((vertical) => (
            <Link
              key={vertical.slug}
              href={`/${vertical.slug}`}
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center gap-2.5 rounded-md px-3 py-2 text-small text-foreground hover:bg-secondary"
            >
              <VerticalIcon vertical={vertical.vertical} className="size-4 text-muted-foreground" />
              {vertical.displayName}
            </Link>
          ))}
          <div className="my-2 h-px bg-border" />
          <Link
            href="/pricing"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center rounded-md px-3 py-2 text-small font-medium text-foreground hover:bg-secondary"
          >
            {t("pricing")}
          </Link>
          <Link
            href="/demo"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center rounded-md px-3 py-2 text-small font-medium text-foreground hover:bg-secondary"
          >
            {t("demo")}
          </Link>
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center rounded-md px-3 py-2 text-small font-medium text-foreground hover:bg-secondary"
          >
            {t("login")}
          </Link>
          <Button asChild size="lg" className="mt-2">
            <Link href="/signup" onClick={() => setOpen(false)}>
              {t("signup")}
            </Link>
          </Button>
          <div className="mt-2 flex justify-center">
            <ThemeToggle />
          </div>
        </nav>
      )}
    </header>
  );
}
