"use client";

import { ThemeToggle } from "@heyloo/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";

/**
 * The marketing header: wordmark, the four home chapters, the demo link and
 * the sign-up button (SITE-3, the approved premium design). Below 880px the
 * chapter links move into a menu button, which also carries "Log in" and the
 * theme toggle so nothing the old header offered is lost on a phone.
 *
 * Every `<Link>` sets `prefetch={false}` (SITE REPAIR round 3): the header is
 * always in the viewport, so Next's default viewport prefetch would pull the
 * `/pricing`, `/login` and `/signup` route chunks right after the home page
 * hydrates and count against the perf budget's initial-JS window.
 */
export function MarketingHeader() {
  const t = useTranslations("Nav");
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // QA-1 F-15: Escape closes the open menu and hands focus back to the
  // toggle (WAI-ARIA disclosure pattern) — listening only while open.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const chapters = [
    { href: "/#call", label: t("call") },
    { href: "/#dashboard", label: t("dashboard") },
    { href: "/#trades", label: t("businesses") },
    { href: "/pricing", label: t("pricing") },
  ] as const;

  return (
    <header className="hdr">
      <div className="hdr-in">
        <Link className="wm kx" href="/" prefetch={false} onClick={close}>
          Heyloo
        </Link>
        <nav className="nav" aria-label="Primary">
          {chapters.map((item) => (
            <Link key={item.href} href={item.href} prefetch={false}>
              {item.label}
            </Link>
          ))}
          <Link href="/login" prefetch={false}>
            {t("login")}
          </Link>
        </nav>
        <div className="hdr-cta">
          <Link className="lnk" href="/#talk" prefetch={false}>
            {t("demo")}
          </Link>
          <Link className="btn btn-p btn-sm" href="/signup" prefetch={false}>
            {t("signup")}
          </Link>
          <div className="hdr-theme">
            <ThemeToggle />
          </div>
          <button
            ref={toggleRef}
            type="button"
            className="hdr-menu"
            aria-label={open ? t("closeMenu") : t("openMenu")}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((o) => !o)}
          >
            <svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">
              {open ? (
                <path
                  d="M4 4l10 10M14 4L4 14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M3 6h12M3 12h12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>
      </div>
      {open ? (
        <nav className="mnav" id="mobile-nav" aria-label="Mobile">
          {chapters.map((item) => (
            <Link key={item.href} href={item.href} prefetch={false} onClick={close}>
              {item.label}
            </Link>
          ))}
          <Link href="/#talk" prefetch={false} onClick={close}>
            {t("demo")}
          </Link>
          <Link href="/login" prefetch={false} onClick={close}>
            {t("login")}
          </Link>
          <div className="hdr-theme">
            <ThemeToggle />
          </div>
        </nav>
      ) : null}
    </header>
  );
}
