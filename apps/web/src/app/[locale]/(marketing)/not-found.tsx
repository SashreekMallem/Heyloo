import { Button, Container, Section } from "@heyloo/ui";
import { PhoneOff } from "lucide-react";
import { Link } from "@/i18n/navigation";

/** Marketing-wide 404 (DESIGN BRIEF: "404" is a named deliverable for this cluster). */
export default function MarketingNotFound() {
  return (
    <Section spacing="spacious" className="pb-24">
      <Container size="content" className="flex flex-col items-center text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary">
          <PhoneOff className="size-7 text-muted-foreground" aria-hidden="true" />
        </span>
        <p className="mt-5 font-mono text-small text-muted-foreground">404</p>
        <h1 className="mt-1 font-display text-h1 font-semibold text-balance">
          This page didn&apos;t pick up
        </h1>
        <p className="mt-2 max-w-md text-body text-pretty text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href="/">Back to home</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/pricing">See pricing</Link>
          </Button>
        </div>
      </Container>
    </Section>
  );
}
