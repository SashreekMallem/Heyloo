import {
  Button,
  Container,
  ENTRANCE_STAGGER_MS,
  MOTION_DURATIONS_MS,
  Section,
  VerticalIcon,
} from "@heyloo/ui";
import { Check } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Reveal } from "@/components/marketing/reveal";
import { getVerticalContent, VERTICAL_CONTENT } from "@/content/marketing/verticals";
import { Link } from "@/i18n/navigation";

export function generateStaticParams() {
  return VERTICAL_CONTENT.map((v) => ({ vertical: v.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ vertical: string }>;
}): Promise<Metadata> {
  const { vertical } = await params;
  const content = getVerticalContent(vertical);
  if (!content) return {};
  return {
    title: `Heyloo for ${content.displayName} — AI answering & booking`,
    description: content.heroStat,
  };
}

/** `/[vertical]` — vertical landing pages, one template (FRONTEND_SPEC.md §3.2). */
export default async function VerticalPage({
  params,
}: {
  params: Promise<{ locale: string; vertical: string }>;
}) {
  const { locale, vertical } = await params;
  setRequestLocale(locale);
  const content = getVerticalContent(vertical);
  if (!content) notFound();

  return (
    <>
      <Section spacing="spacious" className="pt-12 md:pt-16">
        <Container size="content" className="text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-secondary">
            <VerticalIcon vertical={content.vertical} className="size-7 text-foreground" />
          </span>
          <h1 className="mt-5 font-display text-display font-semibold text-balance">
            Heyloo for {content.displayName}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-body text-pretty text-muted-foreground">
            {content.heroStat}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" asChild className="w-full sm:w-auto">
              <Link href={`/demo?vertical=${content.slug}`}>Try a live demo</Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="w-full sm:w-auto">
              <Link href={`/signup?vertical=${content.slug}`}>Get started</Link>
            </Button>
          </div>
        </Container>
      </Section>

      {/* Same "entrance stagger, no scroll-scrub" grammar as the home
          page's business-types grid (DESIGN BRIEF §4) — not a second
          set piece, just a consistent motion vocabulary. */}
      <Section spacing="default" className="border-y border-border bg-muted/30">
        <Container size="wide">
          <div className="grid gap-4 sm:grid-cols-3">
            {content.painStats.map((stat, index) => (
              <Reveal
                key={stat}
                delayMs={index * ENTRANCE_STAGGER_MS.grid}
                durationMs={MOTION_DURATIONS_MS.base}
                translateY={8}
              >
                <div className="rounded-xl border border-border bg-card p-5 text-small text-pretty shadow-xs">
                  {stat}
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      <Section spacing="spacious">
        <Container size="content">
          <div className="grid gap-10 sm:grid-cols-2">
            <div>
              <h2 className="text-h2 font-display font-semibold">
                What your AI receptionist handles
              </h2>
              <ul className="mt-5 space-y-3">
                {content.intakeSummary.map((item, index) => (
                  <Reveal
                    key={item}
                    as="li"
                    delayMs={index * ENTRANCE_STAGGER_MS.grid}
                    durationMs={MOTION_DURATIONS_MS.base}
                    translateY={6}
                    className="flex items-start gap-2.5 text-small"
                  >
                    <Check className="mt-0.5 size-4 shrink-0 text-success" />
                    {item}
                  </Reveal>
                ))}
              </ul>
            </div>

            {/* The "book"/"land" states only of the hero's morph language
                (DESIGN BRIEF §4), pre-filled with this business type's own
                fixture transcript — same TranscriptViewer-styled markup as
                the home hero, different words, no new visual system, and
                not a second pinned set piece (a single entrance fade). */}
            <Reveal
              delayMs={ENTRANCE_STAGGER_MS.grid * 2}
              durationMs={MOTION_DURATIONS_MS.slow}
              translateY={10}
            >
              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <p className="mb-3 text-micro font-medium uppercase tracking-wide text-muted-foreground">
                  A typical call
                </p>
                <div className="space-y-2.5">
                  <p className="max-w-[90%] rounded-lg bg-muted px-3 py-2 text-small">
                    Hi, do you have anything available this week?
                  </p>
                  <p className="ml-auto max-w-[90%] rounded-lg bg-primary/10 px-3 py-2 text-small">
                    This is your AI receptionist — this call is recorded. I can check that for you
                    now.
                  </p>
                  <p className="max-w-[90%] rounded-lg bg-muted px-3 py-2 text-small">
                    Great, let&apos;s book it.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </Container>
      </Section>

      <Section spacing="default" className="border-t border-border">
        <Container size="content" className="text-center">
          <p className="text-small text-pretty text-muted-foreground">{content.competitorAnchor}</p>
          <p className="mt-1 text-body font-medium">
            Plans start at $299/mo — see your real price at signup.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild>
              <Link href={`/demo?vertical=${content.slug}`}>Try a live demo</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href={`/signup?vertical=${content.slug}`}>Get started</Link>
            </Button>
          </div>
        </Container>
      </Section>
    </>
  );
}
