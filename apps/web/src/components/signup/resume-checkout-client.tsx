"use client";

import { Button } from "@heyloo/ui";
import { useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { checkoutErrorMessage, startCheckout } from "@/lib/signup/start-checkout";

/**
 * `/signup/resume` for a confirmed customer: starts Stripe Checkout straight
 * away with the plan they picked before leaving to confirm their email.
 * A failure shows the reason and a retry button rather than a blank screen.
 */
export function ResumeCheckoutClient({
  annual,
  whiteGlove,
  businessName,
}: {
  annual: boolean;
  whiteGlove: boolean;
  businessName: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // React StrictMode runs effects twice in dev; one Checkout Session per attempt.
  const startedFor = useRef<number | null>(null);

  useEffect(() => {
    if (startedFor.current === attempt) return;
    startedFor.current = attempt;
    let cancelled = false;
    void startCheckout({ annual, whiteGlove }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        // Hard redirect to an external (Stripe-hosted) URL; router.push only handles internal routes.
        window.location.href = result.url;
      } else {
        setError(checkoutErrorMessage(result.error));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attempt, annual, whiteGlove]);

  return (
    <div className="mx-auto max-w-md space-y-6 text-center">
      <h1 className="font-display text-h2 font-semibold">Email confirmed</h1>
      {error ? (
        <div className="space-y-4">
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
          <div className="flex justify-center gap-3">
            <Button
              onClick={() => {
                setError(null);
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
            <Button variant="outline" asChild>
              <Link href="/signup">Start over</Link>
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-small text-muted-foreground" role="status">
          Taking you to secure payment for {businessName}…
        </p>
      )}
    </div>
  );
}
