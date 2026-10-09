"use client";

import { Button } from "@heyloo/ui";
import { BellRing } from "lucide-react";
import { Link } from "@/i18n/navigation";

/**
 * The tap that unlocks sound. Browsers keep Web Audio silent until a user
 * gesture, and the wake lock / full screen requests belong to the same tap.
 */
export function StartOverlay({
  businessName,
  onStart,
}: {
  businessName: string;
  onStart: () => void;
}) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{businessName}</p>
          <h1 className="font-display text-h2 font-semibold">Live screen</h1>
          <p className="text-body text-muted-foreground">
            New orders, bookings and messages show up here the moment they come in. The screen stays
            awake and plays a chime until someone handles each one.
          </p>
        </div>
        <Button type="button" size="lg" className="h-14 w-full text-lg" onClick={onStart}>
          <BellRing aria-hidden="true" />
          Start live screen
        </Button>
        <p className="text-sm text-muted-foreground">
          Turn your volume up. On an iPhone or iPad, also switch the ringer on.
        </p>
        <Link
          href="/dashboard"
          className="inline-block text-sm text-accent-text underline underline-offset-2"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
