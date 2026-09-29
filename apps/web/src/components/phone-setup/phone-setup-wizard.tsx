"use client";

import { CARRIERS } from "@heyloo/canonical-types";
import { Button, CarrierForwardingCard, Label, WizardStepper } from "@heyloo/ui";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { CARRIER_CODES, CARRIER_LABELS, dialableNumber } from "./carrier-codes";
import { PortInForm } from "./port-in-form";

type Stage = "carrier" | "verify" | "success" | "port_in";

export interface PhoneSetupWizardProps {
  tenantId: string;
  forwardingNumber: string;
  onboarding: boolean;
  forwardingVerifiedAt?: string | null;
}

/** Same wizard for signup step 6 and `/dashboard/phone-setup` (FRONTEND_SPEC.md §4.6/§6.7); `onboarding` swaps first-run copy and removes the "skip" framing. */
export function PhoneSetupWizard({
  tenantId,
  forwardingNumber,
  onboarding,
  forwardingVerifiedAt,
}: PhoneSetupWizardProps) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>(forwardingVerifiedAt ? "success" : "carrier");
  const [carrier, setCarrier] = useState<(typeof CARRIERS)[number]>("att");
  const [mode, setMode] = useState<"conditional" | "full">("conditional");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"pass" | "fail" | null>(null);

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/phone/forwarding-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, carrier_hint: carrier }),
      });
      const body = (await res.json()) as { verified?: boolean };
      if (res.ok && body.verified) {
        setTestResult("pass");
        setStage("success");
        if (onboarding) setTimeout(() => router.push("/dashboard"), 1800);
      } else {
        setTestResult("fail");
      }
    } catch {
      setTestResult("fail");
    } finally {
      setTesting(false);
    }
  }

  const steps = ["Carrier", "Codes", "Verify", "Done"];
  const currentIndex =
    stage === "carrier" ? 0 : stage === "verify" ? 2 : stage === "success" ? 3 : 1;

  if (stage === "port_in") {
    return <PortInForm onBack={() => setStage("carrier")} />;
  }

  // Never render forwarding codes without a number: "*71" alone would send the
  // customer's calls nowhere (SIGNUP-BILL-FIX C). The number is bought by the
  // provisioning saga, so until it exists there is nothing to forward to.
  if (!forwardingNumber) {
    return (
      <div className="mx-auto max-w-lg space-y-4 text-center" data-testid="number-not-ready">
        <p className="font-medium">Your phone number isn&apos;t ready yet</p>
        <p className="text-sm text-muted-foreground">
          We&apos;re still setting it up. Forwarding codes appear here as soon as your number is
          assigned, usually within a minute.
        </p>
        <Button variant="outline" onClick={() => router.refresh()}>
          Check again
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <WizardStepper
        steps={steps}
        current={currentIndex}
        completed={Array.from({ length: currentIndex }, (_, i) => i)}
      />

      {onboarding && stage === "carrier" && (
        <p className="text-center text-sm text-muted-foreground">
          Let&apos;s forward your business number — this takes about 2 minutes.
        </p>
      )}

      {stage === "carrier" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {CARRIERS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCarrier(c)}
                className={`rounded-md border p-3 text-sm ${carrier === c ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"}`}
              >
                {CARRIER_LABELS[c]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 rounded-md border border-border p-3 text-sm">
            <input
              type="checkbox"
              id="full-forward"
              checked={mode === "full"}
              onChange={(e) => setMode(e.target.checked ? "full" : "conditional")}
            />
            <Label htmlFor="full-forward" className="font-normal">
              Forward all calls instead (faster setup, no fallback if our AI is briefly down)
            </Label>
          </div>

          <CarrierForwardingCard
            carrier={CARRIER_LABELS[carrier]}
            codes={CARRIER_CODES[carrier][mode]}
            forwardingNumber={dialableNumber(forwardingNumber)}
          />

          <div className="flex gap-3">
            <Button className="flex-1" onClick={() => setStage("verify")}>
              I&apos;ve entered the code
            </Button>
          </div>
          <button
            type="button"
            className="w-full text-center text-xs text-muted-foreground underline"
            onClick={() => setStage("port_in")}
          >
            Port your number in instead
          </button>
        </div>
      )}

      {stage === "verify" && (
        <div className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            We&apos;ll place a test call to confirm forwarding is working.
          </p>
          <Button size="lg" className="w-full" onClick={runTest} disabled={testing}>
            {testing ? "Testing…" : "Test it"}
          </Button>
          {testResult === "fail" && (
            <p className="text-sm text-destructive">
              We didn&apos;t receive the call — check the code was entered correctly and try again.
            </p>
          )}
        </div>
      )}

      {stage === "success" && (
        <div className="space-y-2 text-center">
          <p className="text-lg font-medium text-success">You&apos;re live!</p>
          <p className="text-sm text-muted-foreground">
            Calls to your number now reach your AI receptionist.
          </p>
        </div>
      )}
    </div>
  );
}
