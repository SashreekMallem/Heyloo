import { Container } from "@heyloo/ui/layout/container";
import { Section } from "@heyloo/ui/layout/section";
import { cn } from "@heyloo/ui/lib/utils";
import { Button } from "@heyloo/ui/primitives/button";
import { PhoneCall } from "lucide-react";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { DashboardPreview } from "@/components/marketing/dashboard-preview";
import { DemoIconCycle } from "@/components/marketing/demo-icon-cycle";
import { HeroScrollSection } from "@/components/marketing/hero-scroll-section";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { LiveCallHero } from "@/components/marketing/live-call-hero";
import { OwnerPhoneReveal } from "@/components/marketing/owner-phone-reveal";
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

      {/* Hero — `overflow-x-clip`: the visual column bleeds to the right
          viewport edge on `lg:` (see the `HeroScrollSection` className
          below), which can round a stray sub-pixel past 100vw against a
          scrollbar; clip it here rather than let it scroll the page. */}
      <Section spacing="spacious" className="overflow-x-clip pt-12 md:pt-16">
        <Container size="wide">
          <HeroScrollSection
            className={cn(
              // `lg:min-h-[calc(100svh-4rem)]`: the pinned element (this grid) fills
              // the viewport below the 64px sticky header for the entire ~250vh
              // pin, with the row vertically centred — without it the hero sat
              // in the top half of a 1440×900 viewport and the lower half stayed
              // empty for the whole scroll (owner review of wave-2 round-5
              // captures). `5fr_7fr` gives the film column the width the 16:9
              // frame set (1440×810) is worth next to a 3-line display headline.
              "grid items-center gap-10 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-[5fr_7fr] lg:gap-12",
              // Full-bleed-right for the visual column only, `lg:` and up
              // (SITE REPAIR round 4, docs/BUILD_NOTES.md SITE-1: "the
              // visual column may extend past the Container ... use a
              // negative right margin / grid column that ends at 100vw"
              // — while the text column stays on the grid). Targets the
              // grid's 2nd child specifically, and only when it's NOT
              // `aria-hidden` — the qualifying-tier WebGL visual wrapper
              // (`hero-scroll-section.tsx`'s `HeroScrollScene.Visual`,
              // HERO-FILM's file) never carries that attribute itself,
              // while `LiveCallHero` (the non-qualifying/reduced-motion
              // fallback rendered in the SAME DOM position) marks its own
              // root `aria-hidden="true"` — so a desktop visitor on the
              // reduced-motion/no-WebGL fallback tier keeps its normal,
              // Container-width two-panel layout instead of being dragged
              // off past the edge. The margin math mirrors `Container`'s
              // own `size="wide"` (`packages/ui/src/layout/container.tsx`:
              // `max-w-(--breakpoint-xl)` = 90rem, `lg:px-8` = 2rem) —
              // update both together if either changes.
              "lg:[&>*:nth-child(2):not([aria-hidden])]:mr-[calc(-1*max(2rem,(100vw_-_90rem)/2_+_2rem))]",
            )}
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

      {/* Owner phone reveal — beat 6, "Reach the owner" (DESIGN BRIEF §1):
          closes the loop the hero opened. Same visual language as the
          dashboard-reveal panel above it, so the story doesn't reset. */}
      <Section spacing="spacious" className="border-y border-border bg-muted/30">
        <Container size="wide">
          <OwnerPhoneReveal />
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
