"use client";

import { mfaChallengeSchema } from "@heyloo/canonical-types";
import { Button, InputOTP, InputOTPGroup, InputOTPSlot } from "@heyloo/ui";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
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

  async function verify() {
    const parsed = mfaChallengeSchema.safeParse({ code });
    if (!parsed.success) {
      toast.error("Enter the 6-digit code.");
      return;
    }
    setSubmitting(true);
    const { data: factors } = await supabaseBrowserClient.auth.mfa.listFactors();
    const factor = factors?.totp[0];
    if (!factor) {
      setSubmitting(false);
      toast.error("No authenticator found — please contact support.");
      return;
    }
    const { data: challenge, error: challengeError } =
      await supabaseBrowserClient.auth.mfa.challenge({
        factorId: factor.id,
      });
    if (challengeError || !challenge) {
      setSubmitting(false);
      toast.error("Couldn't verify — please try again.");
      return;
    }
    const { error: verifyError } = await supabaseBrowserClient.auth.mfa.verify({
      factorId: factor.id,
      challengeId: challenge.id,
      code,
    });
    setSubmitting(false);
    if (verifyError) {
      toast.error("Incorrect code — please try again.");
      return;
    }
    router.push(searchParams.get("next") ?? "/cockpit");
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-sm flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-2xl font-semibold">Enter your authentication code</h1>
      <InputOTP maxLength={6} value={code} onChange={setCode}>
        <InputOTPGroup>
          {Array.from({ length: 6 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed 6-slot OTP, slot position is the identity
            <InputOTPSlot key={i} index={i} />
          ))}
        </InputOTPGroup>
      </InputOTP>
      <Button className="w-full" onClick={verify} disabled={submitting || code.length !== 6}>
        Verify
      </Button>
    </div>
  );
}
