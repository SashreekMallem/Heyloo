import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@heyloo/ui";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export const metadata: Metadata = {
  title: "Pricing — Heyloo",
  description: "Simple, per-vertical pricing starting at $299/mo — no per-call penalty.",
};

const PRIMARY_FEATURES = [
  "AI answering, 24/7, with disclosed recording",
  "Real bookings written to your calendar",
  "SMS, email, and Airtable delivery",
  "Full dashboard: calls, bookings, customers",
  "No per-call overage penalty",
];

const SECONDARY_FEATURES = [
  "Everything in Primary",
  "Direct write-in to your POS/PMS/CRM",
  "Two-way sync with your existing tools",
  "Priority support",
];

/** `/pricing` — the generic tier comparison only; the real price card never appears here (FRONTEND_SPEC.md §3.3). */
export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <section className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Starting at $299/mo</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Your exact price depends on your business type and call volume — see it in under a minute
          at signup.
        </p>
      </section>

      <section className="mt-12 grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Primary</CardTitle>
            <Badge variant="secondary" className="w-fit">
              Most businesses
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {PRIMARY_FEATURES.map((f) => (
              <p key={f}>✓ {f}</p>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Secondary</CardTitle>
            <Badge variant="outline" className="w-fit">
              Deep integration upsell
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {SECONDARY_FEATURES.map((f) => (
              <p key={f}>✓ {f}</p>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="mt-16">
        <h2 className="text-xl font-semibold">Frequently asked questions</h2>
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
              For most businesses, no — your monthly plan covers setup. Some business types carry a
              one-time setup fee, and white-glove onboarding is available as an optional add-on;
              you&apos;ll see the exact amount, if any applies to you, at signup step 2 before you
              enter payment details.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>

      <div className="mt-12 flex justify-center">
        <Button size="lg" asChild>
          <Link href="/signup">Get started</Link>
        </Button>
      </div>
    </div>
  );
}
