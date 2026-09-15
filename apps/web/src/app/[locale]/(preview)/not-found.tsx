import { Container } from "@heyloo/ui/layout/container";
import { Section } from "@heyloo/ui/layout/section";
import { Button } from "@heyloo/ui/primitives/button";
import { Compass } from "lucide-react";
import { Link } from "@/i18n/navigation";

/**
 * `/preview/**` group-wide 404 — an unregistered path under `/preview`
 * (a typo, or a real route added since the mirror tree was last
 * generated) otherwise fell through to Next's bare, unstyled default 404
 * with no way back to the route index (docs/DESIGN_SYSTEM.md §UI Preview
 * Mode, round-3 design review). Every real detail route's OWN not-found
 * (call/customer/support) still renders first — this is only the
 * fallback once none of those match.
 */
export default function PreviewNotFound() {
  return (
    <Section spacing="spacious" className="pb-24">
      <Container size="content" className="flex flex-col items-center text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary">
          <Compass className="size-7 text-muted-foreground" aria-hidden="true" />
        </span>
        <p className="mt-5 font-mono text-small text-muted-foreground">404</p>
        <h1 className="mt-1 font-display text-h1 font-semibold text-balance">
          No preview route here
        </h1>
        <p className="mt-2 max-w-md text-body text-pretty text-muted-foreground">
          This path isn&apos;t one of the mirrored preview routes.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href="/preview">All preview routes</Link>
          </Button>
        </div>
      </Container>
    </Section>
  );
}
