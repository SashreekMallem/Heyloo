import { Button, Container, Section } from "@heyloo/ui";
import { FileQuestion } from "lucide-react";
import { Link } from "@/i18n/navigation";

export default function BlogPostNotFound() {
  return (
    <Section spacing="spacious" className="pb-24">
      <Container size="content" className="flex flex-col items-center text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary">
          <FileQuestion className="size-7 text-muted-foreground" aria-hidden="true" />
        </span>
        <h1 className="mt-5 font-display text-h1 font-semibold text-balance">Post not found</h1>
        <p className="mt-2 max-w-md text-body text-pretty text-muted-foreground">
          This blog post doesn&apos;t exist or has moved.
        </p>
        <div className="mt-8">
          <Button asChild>
            <Link href="/blog">Back to the blog</Link>
          </Button>
        </div>
      </Container>
    </Section>
  );
}
