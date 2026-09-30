"use client";

import { mfaEnrollSchema } from "@heyloo/canonical-types";
import { Button } from "@heyloo/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthShell } from "@/components/marketing/auth-shell";
import { useRouter } from "@/i18n/navigation";
import { sessionAssuranceFromSupabaseClient } from "@/lib/auth/claims";
import { startTotpEnrollment } from "@/lib/auth/mfa-enroll";
import { OtpCodeInput } from "@/lib/auth/otp-code-input";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

type Enrollment =
  | { kind: "loading" }
  | { kind: "ready"; factorId: string; qrCode: string; secret: string }
  | { kind: "error" };

/**
 * Forced TOTP enrollment for admins, no skip (FRONTEND_SPEC.md §9.1).
 *
 * AUTH-03: safe to open any number of times. Non-admins and admins who
 * already hold a verified factor are redirected instead of creating stray
 * factors; stale unverified factors are cleared before enrolling
 * (`startTotpEnrollment`); failures render inline with a Retry button, never
 * a toast over an empty card.
 */
export default function MfaEnrollPage() {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(false);

  const begin = useCallback(async () => {
    setEnrollment({ kind: "loading" });
    const {
      data: { user },
    } = await supabaseBrowserClient.auth.getUser();
    if (!user) {
      router.replace("/login?next=%2Fmfa%2Fenroll");
      return;
    }
    const { claims, aal, adminMfaRequired } =
      await sessionAssuranceFromSupabaseClient(supabaseBrowserClient);
    if (claims.platform_admin && aal === "aal2") {
      router.replace("/cockpit");
      return;
    }
    // A token minted before SEC-01 still carries `platform_admin` at aal1 and
    // has no `admin_mfa_required` marker; sending it to /cockpit would bounce
    // straight back here (requireAdminSession -> /mfa/enroll), an endless loop.
    // It is an admin who must enroll, exactly like the marker case.
    if (!adminMfaRequired && !claims.platform_admin) {
      router.replace("/no-access");
      return;
    }
    const result = await startTotpEnrollment(supabaseBrowserClient);
    if (result.status === "already_enrolled") {
      router.replace("/mfa/challenge?next=%2Fcockpit");
      return;
    }
    if (result.status === "error") {
      setEnrollment({ kind: "error" });
      return;
    }
    setEnrollment({
      kind: "ready",
      factorId: result.factorId,
      qrCode: result.qrCode,
      secret: result.secret,
    });
  }, [router]);

  useEffect(() => {
    // Once per mount: React strict mode re-runs effects in dev, and every
    // extra run would create (then have to clean up) another factor.
    if (started.current) return;
    started.current = true;
    void begin();
  }, [begin]);

  async function verify() {
    if (enrollment.kind !== "ready") return;
    const { factorId } = enrollment;
    const parsed = mfaEnrollSchema.safeParse({ factor_id: factorId, code });
    if (!parsed.success) {
      setVerifyError("Enter the 6-digit code.");
      return;
    }
    setVerifyError(null);
    setSubmitting(true);
    const { data: challenge, error: challengeError } =
      await supabaseBrowserClient.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setSubmitting(false);
      setVerifyError("Couldn't verify — please try again.");
      return;
    }
    const { error } = await supabaseBrowserClient.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });
    setSubmitting(false);
    if (error) {
      // Clear the wrong code and remount the field so it is focused again.
      setCode("");
      setAttempt((n) => n + 1);
      setVerifyError("Incorrect code — please try again.");
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
        {enrollment.kind === "loading" && (
          <p className="text-small text-muted-foreground" role="status">
            Preparing your authenticator setup…
          </p>
        )}
        {enrollment.kind === "error" && (
          <div className="flex w-full flex-col items-center gap-4">
            <p role="alert" className="text-center text-small text-destructive">
              We couldn&apos;t start two-factor setup. Check your connection and try again.
            </p>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => void begin()}
            >
              Try again
            </Button>
          </div>
        )}
        {enrollment.kind === "ready" && (
          <>
            {/* biome-ignore lint/performance/noImgElement: a data: URI QR code from Supabase, not an optimizable remote asset. */}
            <img
              src={enrollment.qrCode}
              alt="TOTP QR code"
              className="size-48 rounded-lg border border-border p-2"
            />
            <p className="text-center text-small text-muted-foreground">
              Can&apos;t scan? Enter this key in your app:{" "}
              <code className="break-all font-mono text-foreground">{enrollment.secret}</code>
            </p>
            <OtpCodeInput key={attempt} value={code} onChange={setCode} autoFocus={attempt > 0} />
            {verifyError && (
              <p role="alert" className="text-center text-small text-destructive">
                {verifyError}
              </p>
            )}
            <Button
              size="lg"
              className="w-full"
              onClick={verify}
              loading={submitting}
              disabled={code.length !== 6}
            >
              Verify and continue
            </Button>
          </>
        )}
      </div>
    </AuthShell>
  );
}
