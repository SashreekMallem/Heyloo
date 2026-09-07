"use client";

import { Button, PriceCard, WizardStepper } from "@heyloo/ui";
import { useState } from "react";
import type { PriceCardResponse } from "@/app/api/platform-settings/price-card/route";
import { useRouter } from "@/i18n/navigation";

const SIGNUP_STEPS = ["Business info", "Plan", "Account", "Payment", "Provisioning", "Phone setup"];

export function PlanStepClient({ priceCard }: { priceCard: PriceCardResponse }) {
  const router = useRouter();
  const [annual, setAnnual] = useState(false);

  return (
    <div className="mx-auto max-w-md space-y-8">
      <WizardStepper steps={SIGNUP_STEPS} current={1} completed={[0]} />
      <PriceCard
        plan={priceCard}
        annual={annual}
        annualDiscountPct={priceCard.annual_discount_pct}
        onToggleAnnual={setAnnual}
      />
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={() => router.push("/signup")}>
          Back
        </Button>
        <Button
          className="flex-1"
          onClick={() => router.push(`/signup/account${annual ? "?annual=1" : ""}`)}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
