import { useTranslations } from "next-intl";
import { VERTICAL_CONTENT } from "@/content/marketing/verticals";
import { Link } from "@/i18n/navigation";

/**
 * The marketing footer (SITE-3): the approved design's closing block, a
 * blurb, the way back to the demo and sign-up, and the oversized wordmark
 * (the home runtime widens it over the last stretch of the page). It keeps
 * every link the old footer had: business types, product and legal pages.
 * A Server Component: `useTranslations` here resolves on the server.
 */
export function MarketingFooter() {
  const t = useTranslations("Footer");

  return (
    <footer id="foot">
      <div className="ft-in">
        <p className="ft-text">{t("blurb")}</p>
        <nav className="ft-links" aria-label="Footer">
          <Link href="/#talk" prefetch={false}>
            {t("demo")}
          </Link>
          <Link href="/signup" prefetch={false}>
            {t("signup")}
          </Link>
          <Link href="/login" prefetch={false}>
            {t("login")}
          </Link>
        </nav>
        <div className="ft-cols">
          <div>
            <p className="lbl">{t("businessTypes")}</p>
            <ul>
              {VERTICAL_CONTENT.filter((v) => v.slug !== "generic").map((vertical) => (
                <li key={vertical.slug}>
                  <Link href={`/${vertical.slug}`} prefetch={false}>
                    {vertical.displayName}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="lbl">{t("product")}</p>
            <ul>
              <li>
                <Link href="/pricing" prefetch={false}>
                  {t("pricing")}
                </Link>
              </li>
              <li>
                <Link href="/demo" prefetch={false}>
                  {t("buildDemo")}
                </Link>
              </li>
              <li>
                <Link href="/blog" prefetch={false}>
                  {t("blog")}
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="lbl">{t("legal")}</p>
            <ul>
              <li>
                <Link href="/legal/terms" prefetch={false}>
                  {t("terms")}
                </Link>
              </li>
              <li>
                <Link href="/legal/privacy" prefetch={false}>
                  {t("privacy")}
                </Link>
              </li>
              <li>
                <Link href="/legal/dpa" prefetch={false}>
                  {t("dpa")}
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <p className="data ft-fine">
          {t("examples")} © {new Date().getFullYear()} Heyloo. {t("rights")}
        </p>
      </div>
      <p className="ft-mark kx" id="ft-mark" aria-hidden="true">
        Heyloo
      </p>
    </footer>
  );
}
