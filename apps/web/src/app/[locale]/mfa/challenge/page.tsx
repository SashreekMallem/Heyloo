"use client";

import { mfaChallengeSchema } from "@heyloo/canonical-types";
import { Button } from "@heyloo/ui";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthShell } from "@/components/marketing/auth-shell";
import { useRouter } from "@/i18n/navigation";
import { OtpCodeInput } from "@/lib/auth/otp-code-input";
import { sameOriginPath } from "@/lib/auth/same-origin-path";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

/** AAL1→AAL2 step-up (FRONTEND_SPEC.md §9.1). */
export default function MfaChallengePage() {
  return (
    <Suspense fallback={null}>
      <MfaChallengeForm />
    </Suspense>
  );
}

function MfaChallengeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a failed verify: remounts the OTP field so it is cleared and
  // focused again (the old code otherwise stayed in the slots).
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // No session at all: nothing to step up, go and log in (and come back).
    void supabaseBrowserClient.auth.getUser().then(({ data: { user } }) => {
      if (!user) router.replace("/login?next=%2Fmfa%2Fchallenge");
    });
  }, [router]);

  function fail(message: string) {
    setSubmitting(false);
    setError(message);
  }

  async function verify() {
    const parsed = mfaChallengeSchema.safeParse({ code });
    if (!parsed.success) {
      setError("Enter the 6-digit code.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const { data: factors } = await supabaseBrowserClient.auth.mfa.listFactors();
    const factor = factors?.totp[0];
    if (!factor) {
      fail("No authenticator found — please contact support.");
      return;
    }
    const { data: challenge, error: challengeError } =
      await supabaseBrowserClient.auth.mfa.challenge({
        factorId: factor.id,
      });
    if (challengeError || !challenge) {
      fail("Couldn't verify — please try again.");
      return;
    }
    const { error: verifyError } = await supabaseBrowserClient.auth.mfa.verify({
      factorId: factor.id,
      challengeId: challenge.id,
      code,
    });
    if (verifyError) {
      setCode("");
      setAttempt((n) => n + 1);
      fail("Incorrect code — please try again.");
      return;
    }
    setSubmitting(false);
    router.push(sameOriginPath(searchParams.get("next"), window.location.origin) ?? "/cockpit");
  }

  return (
    <AuthShell
      title="Enter your authentication code"
      description="Open your authenticator app and enter the 6-digit code."
    >
      <div className="flex flex-col items-center gap-6">
        <OtpCodeInput key={attempt} value={code} onChange={setCode} autoFocus />
        {error && (
          <p role="alert" className="text-center text-small text-destructive">
            {error}
          </p>
        )}
        <Button
          size="lg"
          className="w-full"
          onClick={verify}
          loading={submitting}
          disabled={code.length !== 6}
        >
          Verify
        </Button>
      </div>
    </AuthShell>
  );
}
