import { Button, Container, Section } from "@heyloo/ui";
import { Compass } from "lucide-react";
import { Link } from "@/i18n/navigation";

export default function VerticalNotFound() {
  return (
    <Section spacing="spacious" className="pb-24">
      <Container size="content" className="flex flex-col items-center text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary">
          <Compass className="size-7 text-muted-foreground" aria-hidden="true" />
        </span>
        <h1 className="mt-5 font-display text-h1 font-semibold text-balance">
          We don&apos;t have a page for that yet
        </h1>
        <p className="mt-2 max-w-md text-body text-pretty text-muted-foreground">
          Try one of the business types from the home page — or get started and we&apos;ll build
          your agent around what you actually do.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href="/">Back to home</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/signup">Get started</Link>
          </Button>
        </div>
      </Container>
    </Section>
  );
}
