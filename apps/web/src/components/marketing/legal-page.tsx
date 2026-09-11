import { Container, Section } from "@heyloo/ui";
import { MDXRemote } from "next-mdx-remote/rsc";
import type { getLegalDoc } from "@/lib/content/legal";

type LegalDoc = Awaited<ReturnType<typeof getLegalDoc>>;

const PROSE_CLASSES =
  "space-y-4 text-body leading-7 text-foreground [&_a]:text-accent-text [&_a]:underline [&_a]:underline-offset-4 [&_h2]:pt-4 [&_h2]:font-display [&_h2]:text-h3 [&_h2]:font-semibold [&_h3]:pt-2 [&_h3]:text-h4 [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ul]:list-disc [&_ul]:space-y-1.5";

/** Shared shell for the three legal docs — terms/privacy/dpa (DESIGN BRIEF: "readable measure, typographic rhythm"). */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <Section spacing="spacious" className="pt-12 md:pt-16">
      <Container size="content">
        <h1 className="font-display text-display font-semibold">{doc.title}</h1>
        <p className="mt-2 text-small text-muted-foreground">Last updated {doc.updated}</p>
        <div className={`mt-8 ${PROSE_CLASSES}`}>
          <MDXRemote source={doc.content} />
        </div>
      </Container>
    </Section>
  );
}
