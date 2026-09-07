"use client";

import {
  CARRIERS,
  type PhonePortInRequest,
  phonePortInRequestSchema,
} from "@heyloo/canonical-types";
import { Button, CarrierForwardingCard, Input, Label, WizardStepper } from "@heyloo/ui";
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";

const CARRIER_LABELS: Record<(typeof CARRIERS)[number], string> = {
  att: "AT&T",
  verizon: "Verizon",
  tmobile: "T-Mobile",
  other_landline: "Other / landline",
};

const CARRIER_CODES: Record<(typeof CARRIERS)[number], { label: string; code: string }[]> = {
  att: [
    { label: "Forward when busy/no answer", code: "*71{number}" },
    { label: "Cancel forwarding", code: "*73" },
  ],
  verizon: [
    { label: "Forward when unanswered", code: "*71{number}" },
    { label: "Cancel forwarding", code: "*73" },
  ],
  tmobile: [
    { label: "Forward when unanswered", code: "*004*{number}#" },
    { label: "Cancel forwarding", code: "##004#" },
  ],
  other_landline: [
    { label: "Conditional call forwarding", code: "*72{number}" },
    { label: "Cancel forwarding", code: "*73" },
  ],
};

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
            codes={CARRIER_CODES[carrier].map((c) =>
              mode === "full" && c.label.toLowerCase().includes("conditional")
                ? { ...c, label: "Forward all calls" }
                : c,
            )}
            forwardingNumber={forwardingNumber}
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

function PortInForm({ onBack }: { onBack: () => void }) {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState<Partial<PhonePortInRequest>>({});

  async function submit() {
    const parsed = phonePortInRequestSchema.safeParse(form);
    if (!parsed.success) {
      toast.error("Please fill in every field.");
      return;
    }
    const res = await fetch("/api/phone/port-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    if (res.ok) setSubmitted(true);
    else toast.error("Something went wrong — please try again.");
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-md space-y-2 text-center">
        <p className="font-medium text-success">Port-in requested</p>
        <p className="text-sm text-muted-foreground">
          This can take several business days — we&apos;ll email you as it progresses.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <button type="button" onClick={onBack} className="text-xs text-muted-foreground underline">
        ← Back to forwarding
      </button>
      <Input
        placeholder="Current number"
        onChange={(e) => setForm((f) => ({ ...f, current_number: e.target.value }))}
      />
      <Input
        placeholder="Account number"
        onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))}
      />
      <Input
        placeholder="Account PIN"
        onChange={(e) => setForm((f) => ({ ...f, account_pin: e.target.value }))}
      />
      <select
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        onChange={(e) =>
          setForm((f) => ({ ...f, carrier: e.target.value as PhonePortInRequest["carrier"] }))
        }
      >
        <option value="">Select carrier</option>
        {CARRIERS.map((c) => (
          <option key={c} value={c}>
            {CARRIER_LABELS[c]}
          </option>
        ))}
      </select>
      <Button className="w-full" onClick={submit}>
        Request port-in
      </Button>
    </div>
  );
}
