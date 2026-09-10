import { Button } from "@heyloo/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
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
    <div className="mx-auto max-w-4xl px-4 py-16">
      <section className="text-center">
        <span className="text-4xl">{content.icon}</span>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">
          Heyloo for {content.displayName}
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">{content.heroStat}</p>
      </section>

      <section className="mt-10 grid gap-4 sm:grid-cols-3">
        {content.painStats.map((stat) => (
          <div key={stat} className="rounded-lg border border-border p-4 text-sm">
            {stat}
          </div>
        ))}
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold">What your AI receptionist handles</h2>
        <ul className="mt-4 space-y-2">
          {content.intakeSummary.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm">
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-10 text-sm text-muted-foreground">{content.competitorAnchor}</p>
      <p className="mt-1 text-sm font-medium">
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
    </div>
  );
}
