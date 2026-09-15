import { Container } from "@heyloo/ui/layout/container";
import { Section } from "@heyloo/ui/layout/section";
import { MOTION_DURATIONS_MS } from "@heyloo/ui/motion-tokens";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@heyloo/ui/primitives/accordion";
import { Badge } from "@heyloo/ui/primitives/badge";
import { Button } from "@heyloo/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@heyloo/ui/primitives/card";
import { Check } from "lucide-react";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Reveal } from "@/components/marketing/reveal";
import { Link } from "@/i18n/navigation";

export const metadata: Metadata = {
  title: "Pricing — Heyloo",
  description: "Simple, per-business pricing starting at $299/mo — no per-call penalty.",
};

/**
 * Customer-facing plan names (DESIGN BRIEF: "plans are named for the buyer
 * ... never internal words"). The generic tier comparison below is the
 * only pricing shown pre-signup by design — see
 * `apps/web/src/app/api/platform-settings/price-card/route.ts`'s doc
 * comment ("the only place the real price card is shown pre-signup") and
 * docs/BUILD_NOTES.md's MARKETING entry for why this page doesn't reveal
 * per-vertical numbers, even though the DESIGN BRIEF asks for them here.
 */
const PLANS = [
  {
    name: "Answer & Book",
    tagline: "Most businesses start here",
    badge: "Most popular",
    features: [
      "AI answering, 24/7, with disclosed recording",
      "Real bookings written to your calendar",
      "SMS, email, and Airtable delivery",
      "Full dashboard: calls, bookings, customers",
      "No per-call overage penalty",
    ],
  },
  {
    name: "Connected",
    tagline: "For teams already running a POS, PMS, or CRM",
    badge: "Deep integration",
    features: [
      "Everything in Answer & Book",
      "Direct write-in to your POS/PMS/CRM",
      "Two-way sync with your existing tools",
      "Priority support",
    ],
  },
];

/** `/pricing` — the generic tier comparison only; the real price card never appears here (FRONTEND_SPEC.md §3.3). */
export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <Section spacing="spacious" className="pt-12 md:pt-16">
        <Container size="content" className="text-center">
          <h1 className="font-display text-display font-semibold text-balance">
            Starting at $299/mo
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-body text-pretty text-muted-foreground">
            Your exact price depends on your business type and call volume — see it in under a
            minute at signup, before you ever enter payment details.
          </p>
        </Container>

        <Container size="wide">
          {/* No 3D, no scroll-scrub (DESIGN BRIEF §4, "/pricing"): this is
              a decision page — a fast, once, on-enter fade/slide per
              plan card, staggered, matching the home page's pricing-teaser
              treatment. Premium here means clarity and legibility, not
              motion. */}
          <div className="mx-auto mt-12 grid max-w-3xl gap-6 sm:grid-cols-2">
            {PLANS.map((plan, index) => (
              <Reveal
                key={plan.name}
                delayMs={index * 60}
                durationMs={MOTION_DURATIONS_MS.base}
                translateY={8}
              >
                <Card className="flex h-full flex-col">
                  <CardHeader className="space-y-2">
                    <Badge
                      variant={plan.badge === "Most popular" ? "default" : "secondary"}
                      className="w-fit"
                    >
                      {plan.badge}
                    </Badge>
                    <CardTitle className="font-display text-h3 font-semibold">
                      {plan.name}
                    </CardTitle>
                    <p className="text-small text-muted-foreground">{plan.tagline}</p>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-2.5 text-small">
                    {plan.features.map((f) => (
                      <p key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-success" />
                        {f}
                      </p>
                    ))}
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      <Section spacing="default" className="border-t border-border">
        <Container size="content">
          <h2 className="text-h2 font-display font-semibold">Frequently asked questions</h2>
          <Accordion type="single" collapsible className="mt-4">
            <AccordionItem value="billing">
              <AccordionTrigger>How does billing work?</AccordionTrigger>
              <AccordionContent>
                A flat monthly base fee includes a set number of minutes for your plan; usage past
                that is billed per minute, with no punitive per-call fee the way many answering
                services charge.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="minute">
              <AccordionTrigger>What counts as a minute?</AccordionTrigger>
              <AccordionContent>
                Talk time on any call your AI answers, from greeting to hang-up. Calls from your own
                registered test number never count toward usage.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="cancel">
              <AccordionTrigger>Can I leave, and do I keep my number?</AccordionTrigger>
              <AccordionContent>
                Yes — cancel any time, and we guarantee a smooth port-out of your business phone
                number if you switch providers.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="setup-fee">
              <AccordionTrigger>Is there a setup fee?</AccordionTrigger>
              <AccordionContent>
                For most businesses, no — your monthly plan covers setup. Some business types carry
                a one-time setup fee, and white-glove onboarding is available as an optional add-on;
                you&apos;ll see the exact amount, if any applies to you, at signup step 2 before you
                enter payment details.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Container>
      </Section>

      <Section spacing="default" className="pb-24">
        <Container size="content" className="flex justify-center">
          <Button size="lg" asChild>
            <Link href="/signup">Get started</Link>
          </Button>
        </Container>
      </Section>
    </>
  );
}
