import { VerticalIcon } from "@heyloo/ui/icons";
import { Container } from "@heyloo/ui/layout/container";
import { Section } from "@heyloo/ui/layout/section";
import { Check } from "lucide-react";
import type { Metadata } from "next";
import { DemoFlow } from "@/components/demo/demo-flow";
import { isDemoVertical } from "@/components/demo/demo-verticals";
import { TalkLive } from "@/components/demo/talk-live";
import { getVerticalContent } from "@/content/marketing/verticals";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: "Try a live demo — Heyloo",
  description:
    "Pick a kind of business and talk to its AI receptionist for 30 seconds, or build a demo from your own website.",
};

const WHAT_HAPPENS_NEXT = [
  "We read your website and pull your business name, hours, and services.",
  "You confirm or tweak what we found — takes a few seconds.",
  "Talk to your demo agent right in the browser, or call the number it gives you.",
];

/**
 * `/demo` (FRONTEND_SPEC.md §3.4): the live demo up top (pick a business type,
 * talk to that AI for at most 30 seconds, DEMO-2), then the personalised flow
 * that builds a demo from the visitor's own website, hosted as a client
 * `<DemoFlow>` state machine.
 */
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ vertical?: string }>;
}) {
  const { vertical } = await searchParams;
  const content = vertical ? getVerticalContent(vertical) : undefined;
  const initialVertical =
    content && isDemoVertical(content.vertical) ? content.vertical : undefined;

  return (
    <Section spacing="spacious" className="pt-12 pb-24 md:pt-16">
      <Container size="wide">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="d2s kx">Hear your AI receptionist in under a minute</h1>
          <p className="lede mx-auto mt-4">
            No signup, no call script. Pick a kind of business and talk to it, or build a demo from
            your own website.
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-[640px]">
          <TalkLive demoPhone={env.demoPhoneE164} initialVertical={initialVertical} />
        </div>

        <div className="mx-auto mt-16 max-w-2xl text-center">
          <h2 className="font-display text-h3 font-semibold">
            Or build a demo for your own business
          </h2>
        </div>

        <div className="mx-auto mt-8 grid max-w-4xl gap-10 lg:grid-cols-[1fr_0.85fr] lg:items-start lg:gap-14">
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
