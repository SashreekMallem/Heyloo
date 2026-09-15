import { Container } from "@heyloo/ui/layout/container";
import { PageHeader } from "@heyloo/ui/layout/page-header";
import { Section } from "@heyloo/ui/layout/section";
import { ThemeToggle } from "@heyloo/ui/layout/theme-toggle";
import { Badge } from "@heyloo/ui/primitives/badge";
import { Card, CardContent } from "@heyloo/ui/primitives/card";
import type { Metadata } from "next";
import Link from "next/link";
import { PREVIEW_ROUTES } from "@/lib/preview/routes";

export const metadata: Metadata = { title: "UI Preview index — Heyloo" };

/** `/preview` (and `/preview/index`) — every mirrored tenant/admin/partner page, for reviewer screenshots (docs/DESIGN_SYSTEM.md §UI Preview Mode). */
export default function PreviewIndexPage() {
  const areas = [...new Set(PREVIEW_ROUTES.map((r) => r.area))];

  return (
    <Container size="wide">
      <Section spacing="compact">
        <PageHeader
          eyebrow="Heyloo design system"
          title="UI Preview routes"
          description={`${PREVIEW_ROUTES.length} real page components, rendered against fixture data. Sidebar/nav links inside a mirrored page point at the real (authenticated) route, not another /preview page — open each row below directly instead.`}
          actions={
            <>
              <Link href="/preview/system">
                <Badge variant="secondary" className="cursor-pointer px-3 py-1.5">
                  Component gallery →
                </Badge>
              </Link>
              <ThemeToggle />
            </>
          }
        />

        <div className="mt-8 space-y-8">
          {areas.map((area) => (
            <div key={area}>
              <h2 className="mb-3 text-h4 font-semibold">{area}</h2>
              <Card>
                <CardContent className="grid gap-px overflow-hidden rounded-lg bg-border p-0 sm:grid-cols-2 lg:grid-cols-3">
                  {PREVIEW_ROUTES.filter((r) => r.area === area).map((route) => (
                    <Link
                      key={route.url}
                      href={route.href}
                      className="flex flex-col gap-0.5 bg-card px-4 py-3 transition-colors duration-(--duration-fast) hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    >
                      <span className="text-body font-medium">{route.label}</span>
                      <span className="truncate font-mono text-micro text-muted-foreground">
                        {route.url}
                      </span>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      </Section>
    </Container>
  );
}
