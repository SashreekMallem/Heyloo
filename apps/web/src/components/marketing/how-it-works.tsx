"use client";

import { useInView } from "@/lib/marketing/use-in-view";
import { HOME_CONTENT } from "@/content/marketing/home";

/**
 * "How it works" — three-step numbered list (DESIGN BRIEF §2, "How it
 * works"): the site's quietest section. Each numbered circle pulses
 * (`1 → 1.06 → 1`, ~300ms) once as its row crosses the viewport center — a
 * metronome read, not a spectacle. `rootMargin` shrinks the effective
 * viewport to a thin band at vertical center so "crosses center" is
 * literal, not just "entered."
 */
export function HowItWorks() {
  return (
    <div className="mt-12 grid gap-8 sm:grid-cols-3 sm:gap-6">
      {/* Scoped keyframe — arbitrary Tailwind `animate-[...]` values need
          the @keyframes rule on the page; kept local to this component
          rather than the shared stylesheet (packages/ui is out of this
          cluster's ownership), one copy for the whole section. */}
      <style>{`
        @keyframes heyloo-step-pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.06); }
          100% { transform: scale(1); }
        }
      `}</style>
      {HOME_CONTENT.howItWorks.map((step, index) => (
        <Step key={step.title} index={index} title={step.title} description={step.description} />
      ))}
    </div>
  );
}

function Step({ index, title, description }: { index: number; title: string; description: string }) {
  const [ref, pulsed] = useInView<HTMLSpanElement>({
    threshold: 0,
    rootMargin: "-45% 0px -45% 0px",
  });

  return (
    <div className="space-y-3 text-center sm:text-left">
      <span
        ref={ref}
        className={
          pulsed
            ? "mx-auto flex size-10 items-center justify-center rounded-full bg-primary font-display text-h4 font-semibold text-primary-foreground sm:mx-0 animate-[heyloo-step-pulse_300ms_var(--ease-out)]"
            : "mx-auto flex size-10 items-center justify-center rounded-full bg-primary font-display text-h4 font-semibold text-primary-foreground sm:mx-0"
        }
      >
        {index + 1}
      </span>
      <h3 className="text-h4 font-semibold">{title}</h3>
      <p className="text-small text-pretty text-muted-foreground">{description}</p>
    </div>
  );
}
