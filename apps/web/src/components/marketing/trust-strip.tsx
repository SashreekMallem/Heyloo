"use client";

import { cn } from "@heyloo/ui";
import type { LucideIcon } from "lucide-react";
import { Mic, PhoneForwarded, ShieldCheck } from "lucide-react";
import { Reveal } from "@/components/marketing/reveal";

const ITEMS: { icon: LucideIcon; label: string }[] = [
  { icon: ShieldCheck, label: "Every call discloses it's an AI" },
  { icon: Mic, label: "Recorded with consent, every time" },
  { icon: PhoneForwarded, label: "Your business number stays yours" },
];

/**
 * Compliance/trust strip (DESIGN BRIEF) — restrained, no accent color; this
 * is reassurance copy, not a call to action. Motion (DESIGN BRIEF §2): "a
 * single, fast (150ms) fade/slide-up on first enter ... this is an
 * entrance, not a scroll story" — `Reveal`'s default duration is exactly
 * this 150ms, so no override is passed.
 */
export function TrustStrip({ className }: { className?: string }) {
  return (
    <Reveal>
      <div
        className={cn(
          "flex flex-col flex-wrap items-center gap-x-8 gap-y-3 text-small text-muted-foreground sm:flex-row sm:justify-center",
          className,
        )}
      >
        {ITEMS.map(({ icon: Icon, label }) => (
          <span key={label} className="flex items-center gap-2">
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
    </Reveal>
  );
}
