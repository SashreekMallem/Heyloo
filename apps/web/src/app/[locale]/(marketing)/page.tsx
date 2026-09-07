import { Button } from "@heyloo/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { RoleGuardToast } from "@/components/shared/role-guard-toast";
import { HOME_CONTENT } from "@/content/marketing/home";
import { VERTICAL_CONTENT } from "@/content/marketing/verticals";
import { Link } from "@/i18n/navigation";

export const metadata: Metadata = {
  title: "Heyloo — Your AI receptionist, answering every call",
  description:
    "Heyloo answers every call for your business, books real appointments, and delivers the details by SMS and email — starting at $299/mo.",
};

/** `/` — Home (FRONTEND_SPEC.md §3.1). RSC, ~zero client JS. */
export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <Suspense fallback={null}>
        <RoleGuardToast />
      </Suspense>
      <section className="mx-auto max-w-3xl text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Every call answered. Every booking captured.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Heyloo is an AI receptionist that answers your business phone 24/7, books real
          appointments into your calendar, and disclosed AI, disclosed recording — every time.
        </p>
        <p className="mt-6 text-sm font-medium text-muted-foreground">
          {HOME_CONTENT.heroStats[0]}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" asChild>
            <Link href="/demo">Try a live demo</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/signup">Get started</Link>
          </Button>
        </div>
      </section>

      <section className="mt-20">
        <h2 className="text-center text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Built for your business
        </h2>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {VERTICAL_CONTENT.map((vertical) => (
            <Link
              key={vertical.slug}
              href={`/${vertical.slug}`}
              className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 text-center transition-colors hover:bg-secondary"
            >
              <span className="text-2xl">{vertical.icon}</span>
              <span className="text-sm font-medium">{vertical.displayName}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-20 grid gap-8 sm:grid-cols-3">
        {HOME_CONTENT.howItWorks.map((step, index) => (
          <div key={step.title} className="space-y-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
              {index + 1}
            </span>
            <h3 className="font-medium">{step.title}</h3>
            <p className="text-sm text-muted-foreground">{step.description}</p>
          </div>
        ))}
      </section>

      <section className="mt-20 rounded-lg border border-border bg-secondary/40 p-8 text-center">
        <h2 className="text-2xl font-semibold">Starting at $299/mo</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          No per-call penalty. See the plan built for your business at signup.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild>
            <Link href="/pricing">See pricing</Link>
          </Button>
        </div>
      </section>

      <section className="mt-20 rounded-lg border border-primary/30 bg-primary/5 p-8 text-center">
        <h2 className="text-2xl font-semibold">Hear it for yourself</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A personalized demo agent, built from your own website, in under a minute.
        </p>
        <div className="mt-6 flex justify-center">
          <Button size="lg" asChild>
            <Link href="/demo">Try a live demo</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
