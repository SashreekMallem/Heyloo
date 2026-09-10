"use client";

import { mfaEnrollSchema } from "@heyloo/canonical-types";
import { Button, InputOTP, InputOTPGroup, InputOTPSlot } from "@heyloo/ui";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AuthShell } from "@/components/marketing/auth-shell";
import { useRouter } from "@/i18n/navigation";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

/** Forced TOTP enrollment for admins, no skip (FRONTEND_SPEC.md §9.1). */
export default function MfaEnrollPage() {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabaseBrowserClient.auth.mfa.enroll({ factorType: "totp" });
      if (error) {
        toast.error("Couldn't start MFA enrollment.");
        return;
      }
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
    })();
  }, []);

  async function verify() {
    if (!factorId) return;
    const parsed = mfaEnrollSchema.safeParse({ factor_id: factorId, code });
    if (!parsed.success) {
      toast.error("Enter the 6-digit code.");
      return;
    }
    setSubmitting(true);
    const { data: challenge, error: challengeError } =
      await supabaseBrowserClient.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setSubmitting(false);
      toast.error("Couldn't verify — please try again.");
      return;
    }
    const { error: verifyError } = await supabaseBrowserClient.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });
    setSubmitting(false);
    if (verifyError) {
      toast.error("Incorrect code — please try again.");
      return;
    }
    router.push("/cockpit");
  }

  return (
    <AuthShell
      title="Set up two-factor authentication"
      description="Admin accounts require an authenticator app. Scan the code below, then enter the 6-digit code it shows."
    >
      <div className="flex flex-col items-center gap-6">
        {qrCode && (
          // biome-ignore lint/performance/noImgElement: a data: URI QR code from Supabase, not an optimizable remote asset.
          <img
            src={qrCode}
            alt="TOTP QR code"
            className="size-48 rounded-lg border border-border p-2"
          />
        )}
        <InputOTP maxLength={6} value={code} onChange={setCode}>
          <InputOTPGroup>
            {Array.from({ length: 6 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed 6-slot OTP, slot position is the identity
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <Button
          size="lg"
          className="w-full"
          onClick={verify}
          loading={submitting}
          disabled={code.length !== 6}
        >
          Verify and continue
        </Button>
      </div>
    </AuthShell>
  );
}
