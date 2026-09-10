"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { Button, Card, CardContent, Checkbox, Label, PriceCard, WizardStepper } from "@heyloo/ui";
import { useState } from "react";
import type { PriceCardResponse } from "@/app/api/platform-settings/price-card/route";
import { useRouter } from "@/i18n/navigation";

const SIGNUP_STEPS = ["Business info", "Plan", "Account", "Payment", "Provisioning", "Phone setup"];

export function PlanStepClient({ priceCard }: { priceCard: PriceCardResponse }) {
  const router = useRouter();
  const [annual, setAnnual] = useState(false);
  const [whiteGlove, setWhiteGlove] = useState(false);

  const hasOnboardingFees =
    priceCard.setup_fee_cents != null || priceCard.white_glove_fee_cents != null;
  const whiteGloveAvailable = priceCard.white_glove_fee_cents != null;

  function handleContinue() {
    const params = new URLSearchParams();
    if (annual) params.set("annual", "1");
    if (whiteGloveAvailable && whiteGlove) params.set("white_glove", "1");
    const query = params.toString();
    router.push(`/signup/account${query ? `?${query}` : ""}`);
  }

  return (
    <div className="mx-auto max-w-md space-y-8">
      <WizardStepper steps={SIGNUP_STEPS} current={1} completed={[0]} />
      <PriceCard
        plan={priceCard}
        annual={annual}
        annualDiscountPct={priceCard.annual_discount_pct}
        onToggleAnnual={setAnnual}
      />
      {hasOnboardingFees && (
        <Card>
          <CardContent className="space-y-2 pt-6 text-sm">
            {priceCard.setup_fee_cents != null && (
              <div className="flex items-center justify-between">
                <span>One-time setup fee</span>
                <span className="font-medium">{formatCentsUSD(priceCard.setup_fee_cents)}</span>
              </div>
            )}
            {priceCard.white_glove_fee_cents != null && (
              <div className="flex items-start justify-between gap-2 border-t border-border pt-2">
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="white-glove-toggle"
                    checked={whiteGlove}
                    onCheckedChange={(checked) => setWhiteGlove(checked === true)}
                  />
                  <Label htmlFor="white-glove-toggle" className="font-normal">
                    Add white-glove onboarding (optional)
                  </Label>
                </div>
                <span className="font-medium">
                  {formatCentsUSD(priceCard.white_glove_fee_cents)}
                </span>
              </div>
            )}
            {priceCard.white_glove_description && (
              <p className="text-xs text-muted-foreground">{priceCard.white_glove_description}</p>
            )}
          </CardContent>
        </Card>
      )}
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={() => router.push("/signup")}>
          Back
        </Button>
        <Button className="flex-1" onClick={handleContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
}
