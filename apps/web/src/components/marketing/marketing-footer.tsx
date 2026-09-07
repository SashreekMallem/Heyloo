import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function MarketingFooter() {
  const t = useTranslations("Footer");
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {new Date().getFullYear()} Heyloo. {t("rights")}
        </p>
        <nav className="flex gap-4">
          <Link href="/legal/terms">{t("terms")}</Link>
          <Link href="/legal/privacy">{t("privacy")}</Link>
          <Link href="/legal/dpa">{t("dpa")}</Link>
        </nav>
      </div>
    </footer>
  );
}
