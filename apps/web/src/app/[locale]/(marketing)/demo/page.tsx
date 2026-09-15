import { VerticalIcon } from "@heyloo/ui/icons";
import { Container } from "@heyloo/ui/layout/container";
import { Section } from "@heyloo/ui/layout/section";
import { Check } from "lucide-react";
import type { Metadata } from "next";
import { DemoFlow } from "@/components/demo/demo-flow";
import { getVerticalContent } from "@/content/marketing/verticals";

export const metadata: Metadata = {
  title: "Try a live demo — Heyloo",
  description: "Build a personalized AI receptionist demo from your own website in under a minute.",
};

const WHAT_HAPPENS_NEXT = [
  "We read your website and pull your business name, hours, and services.",
  "You confirm or tweak what we found — takes a few seconds.",
  "Talk to your demo agent right in the browser, or call the number it gives you.",
];

/** `/demo` (FRONTEND_SPEC.md §3.4) — the most interactive marketing surface, hosted as a client `<DemoFlow>` state machine in one route. */
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ vertical?: string }>;
}) {
  const { vertical } = await searchParams;
  const content = vertical ? getVerticalContent(vertical) : undefined;

  return (
    <Section spacing="spacious" className="pt-12 pb-24 md:pt-16">
      <Container size="wide">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-display text-display font-semibold text-balance">
            Hear your AI receptionist in under a minute
          </h1>
          <p className="mt-3 text-body text-pretty text-muted-foreground">
            No signup, no call script — just your business, answered the way it actually should be.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl gap-10 lg:grid-cols-[1fr_0.85fr] lg:items-start lg:gap-14">
          <DemoFlow initialVertical={vertical} />

          <aside className="space-y-6 rounded-2xl border border-border bg-card p-6 shadow-sm lg:sticky lg:top-24">
            {content && (
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-lg bg-secondary">
                  <VerticalIcon vertical={content.vertical} className="size-4" />
                </span>
                <p className="text-small font-medium">Built for {content.displayName}</p>
              </div>
            )}
            <div>
              <p className="text-micro font-medium uppercase tracking-wide text-muted-foreground">
                What happens next
              </p>
              <ol className="mt-3 space-y-3">
                {WHAT_HAPPENS_NEXT.map((step, i) => (
                  <li key={step} className="flex items-start gap-2.5 text-small">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-micro font-medium text-secondary-foreground">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
            <div className="border-t border-border pt-4">
              <p className="flex items-start gap-2 text-small text-muted-foreground">
                <Check className="mt-0.5 size-4 shrink-0 text-success" />
                Every demo agent discloses it&apos;s AI and that the call is recorded — same as a
                live agent on your account.
              </p>
            </div>
          </aside>
        </div>
      </Container>
    </Section>
  );
}
