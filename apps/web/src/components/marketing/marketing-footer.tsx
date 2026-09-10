import { Container, VerticalIcon } from "@heyloo/ui";
import { Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import { VERTICAL_CONTENT } from "@/content/marketing/verticals";
import { Link } from "@/i18n/navigation";

export function MarketingFooter() {
  const t = useTranslations("Footer");

  return (
    <footer className="border-t border-border">
      <Container size="wide" className="py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div className="space-y-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Phone className="size-3.5" aria-hidden="true" />
              </span>
              <span className="font-display text-h4 font-semibold">Heyloo</span>
            </Link>
            <p className="max-w-xs text-small text-muted-foreground">
              An AI receptionist that answers every call, books real appointments, and always
              discloses it&apos;s AI.
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-small font-medium">Business types</p>
            <ul className="space-y-2">
              {VERTICAL_CONTENT.filter((v) => v.slug !== "generic")
                .slice(0, 5)
                .map((vertical) => (
                  <li key={vertical.slug}>
                    <Link
                      href={`/${vertical.slug}`}
                      className="flex items-center gap-2 text-small text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <VerticalIcon vertical={vertical.vertical} className="size-3.5" />
                      {vertical.displayName}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>

          <div className="space-y-3">
            <p className="text-small font-medium">Product</p>
            <ul className="space-y-2 text-small text-muted-foreground">
              <li>
                <Link href="/pricing" className="transition-colors hover:text-foreground">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/demo" className="transition-colors hover:text-foreground">
                  Live demo
                </Link>
              </li>
              <li>
                <Link href="/blog" className="transition-colors hover:text-foreground">
                  Blog
                </Link>
              </li>
              <li>
                <Link href="/signup" className="transition-colors hover:text-foreground">
                  Get started
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <p className="text-small font-medium">Legal</p>
            <ul className="space-y-2 text-small text-muted-foreground">
              <li>
                <Link href="/legal/terms" className="transition-colors hover:text-foreground">
                  {t("terms")}
                </Link>
              </li>
              <li>
                <Link href="/legal/privacy" className="transition-colors hover:text-foreground">
                  {t("privacy")}
                </Link>
              </li>
              <li>
                <Link href="/legal/dpa" className="transition-colors hover:text-foreground">
                  {t("dpa")}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-border pt-6">
          <p className="text-small text-muted-foreground">
            © {new Date().getFullYear()} Heyloo. {t("rights")}
          </p>
        </div>
      </Container>
    </footer>
  );
}
