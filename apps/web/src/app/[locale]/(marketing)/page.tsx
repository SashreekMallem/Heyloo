import { Button, Container, Section } from "@heyloo/ui";
import { PhoneCall } from "lucide-react";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { DashboardPreview } from "@/components/marketing/dashboard-preview";
import { DemoIconCycle } from "@/components/marketing/demo-icon-cycle";
import { HeroScrollSection } from "@/components/marketing/hero-scroll-section";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { LiveCallHero } from "@/components/marketing/live-call-hero";
import { Reveal } from "@/components/marketing/reveal";
import { TrustStrip } from "@/components/marketing/trust-strip";
import { VerticalGrid } from "@/components/marketing/vertical-grid";
import { RoleGuardToast } from "@/components/shared/role-guard-toast";
import { HOME_CONTENT } from "@/content/marketing/home";
import { Link } from "@/i18n/navigation";

export const metadata: Metadata = {
  title: "Heyloo — Your AI receptionist, answering every call",
  description:
    "Heyloo answers every call for your business, books real appointments, and delivers the details by SMS and email — starting at $299/mo.",
};

/** `/` — Home (FRONTEND_SPEC.md §3.1). RSC, ~zero client JS. */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <Suspense fallback={null}>
        <RoleGuardToast />
      </Suspense>

      {/* Hero */}
      <Section spacing="spacious" className="pt-12 md:pt-16">
        <Container size="wide">
          <HeroScrollSection
            className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
            visualFallback={<LiveCallHero />}
          >
            <div className="space-y-6 text-center lg:text-left">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-small font-medium text-secondary-foreground">
                <PhoneCall className="size-3.5 text-primary" aria-hidden="true" />
                AI receptionist for real businesses
              </span>
              <h1 className="font-display text-display font-semibold text-balance">
                Every call answered.
                <br />
                Every booking captured.
              </h1>
              <p className="mx-auto max-w-xl text-body text-pretty text-muted-foreground lg:mx-0">
                Heyloo answers your business phone 24/7, books real appointments straight into your
                calendar, and always discloses it&apos;s AI and that the call is recorded.
              </p>
              <p className="text-small font-medium text-muted-foreground">
                {HOME_CONTENT.heroStats[0]}
              </p>
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
                <Button size="lg" asChild className="w-full sm:w-auto">
                  <Link href="/demo">Try a live demo</Link>
                </Button>
                <Button size="lg" variant="outline" asChild className="w-full sm:w-auto">
                  <Link href="/signup">Get started</Link>
                </Button>
              </div>
            </div>
          </HeroScrollSection>
        </Container>
      </Section>

      {/* Trust strip */}
      <Section spacing="compact" className="border-y border-border bg-muted/30">
        <Container size="wide">
          <TrustStrip />
        </Container>
      </Section>

      {/* Business types */}
      <Section spacing="spacious">
        <Container size="wide">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-h1 font-semibold text-balance">
              Built for your business
            </h2>
            <p className="mt-3 text-body text-pretty text-muted-foreground">
              Every business type gets an agent that knows how it actually operates — not a generic
              script.
            </p>
          </div>
          <div className="mt-10">
            <VerticalGrid />
          </div>
        </Container>
      </Section>

      {/* How it works */}
      <Section spacing="spacious" className="border-y border-border bg-muted/30">
        <Container size="wide">
          <h2 className="text-center font-display text-h1 font-semibold text-balance">
            How it works
          </h2>
          <HowItWorks />
        </Container>
      </Section>

      {/* Dashboard preview */}
      <Section spacing="spacious">
        <Container size="wide">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-h1 font-semibold text-balance">
              Every call, every booking, in one place
            </h2>
            <p className="mt-3 text-body text-pretty text-muted-foreground">
              Calls, bookings, and customers land in a dashboard you actually check — not another
              inbox.
            </p>
          </div>
          <div className="mt-10">
            <DashboardPreview />
          </div>
        </Container>
      </Section>

      {/* Pricing teaser — static card, single fast fade/slide-up entrance
          only (DESIGN BRIEF §2: "this is a pause-and-decide moment; motion
          here would undercut it"). */}
      <Section spacing="default">
        <Container size="wide">
          <Reveal>
            <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm sm:p-12">
              <h2 className="font-display text-h2 font-semibold">Starting at $299/mo</h2>
              <p className="mx-auto mt-2 max-w-md text-small text-pretty text-muted-foreground">
                No per-call penalty. See the plan built for your business type at signup.
              </p>
              <div className="mt-6 flex justify-center">
                <Button asChild>
                  <Link href="/pricing">See pricing</Link>
                </Button>
              </div>
            </div>
          </Reveal>
        </Container>
      </Section>

      {/* Demo CTA */}
      <Section spacing="default" className="pb-24">
        <Container size="wide">
          <Reveal>
            <div className="rounded-2xl border border-primary/25 bg-primary/5 p-8 text-center sm:p-12">
              <DemoIconCycle className="mx-auto" />
              <h2 className="mt-4 font-display text-h2 font-semibold">Hear it for yourself</h2>
              <p className="mx-auto mt-2 max-w-md text-small text-pretty text-muted-foreground">
                A personalized demo agent, built from your own website, in under a minute.
              </p>
              <div className="mt-6 flex justify-center">
                <Button size="lg" asChild>
                  <Link href="/demo">Try a live demo</Link>
                </Button>
              </div>
            </div>
          </Reveal>
        </Container>
      </Section>
    </>
  );
}
