"use client";

import { ThemeToggle } from "@heyloo/ui";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { Link } from "@/i18n/navigation";
import { hasSupabaseSessionCookie } from "@/lib/auth/session-cookie";

/** The session cookie is not observable; the snapshot is simply read once per render. */
const subscribeNever = () => () => {};

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
  // AUTH-09/PT-10: a signed-in visitor sees "Your account" instead of "Log
  // in". Cheap client-side cookie-presence check — no Supabase client in the
  // marketing bundle (perf budget), and the page stays statically rendered.
  // `/login` bounces a signed-in visitor to their role home (middleware).
  // `useSyncExternalStore`: the server (and hydration) snapshot is `false`, the
  // client snapshot reads the cookie, so there is no hydration mismatch.
  const signedIn = useSyncExternalStore(
    subscribeNever,
    () => hasSupabaseSessionCookie(document.cookie),
    () => false,
  );
  const loginLabel = signedIn ? t("account") : t("login");

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
            {loginLabel}
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
            {loginLabel}
          </Link>
          <div className="hdr-theme">
            <ThemeToggle />
          </div>
        </nav>
      ) : null}
    </header>
  );
}
