"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../primitives/card.js";
import { Label } from "../primitives/label.js";
import { Switch } from "../primitives/switch.js";

export interface PriceCardPlan {
  base_cents: number;
  included_minutes: number;
  overage_cents: number;
}

export interface PriceCardProps {
  plan: PriceCardPlan;
  annual: boolean;
  annualDiscountPct: number;
  onToggleAnnual: (annual: boolean) => void;
}

/** Vertical price card reveal — the only place the real price is shown pre-signup (FRONTEND_SPEC.md §1.3/§4.2). */
export function PriceCard({ plan, annual, annualDiscountPct, onToggleAnnual }: PriceCardProps) {
  const monthlyEquivalent = annual
    ? Math.round(plan.base_cents * (1 - annualDiscountPct / 100))
    : plan.base_cents;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-base font-medium">Your plan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <span className="text-3xl font-semibold">{formatCentsUSD(monthlyEquivalent)}</span>
          <span className="text-sm text-muted-foreground">/mo</span>
          {annual && (
            <p className="text-xs text-success">
              {annualDiscountPct}% off with annual prepay (billed yearly)
            </p>
          )}
        </div>
        <ul className="space-y-1.5 text-sm">
          <li className="flex items-center gap-2">
            <Check className="size-4 text-success" /> {plan.included_minutes.toLocaleString()}{" "}
            minutes included
          </li>
          <li className="flex items-center gap-2">
            <Check className="size-4 text-success" /> {formatCentsUSD(plan.overage_cents)}/min after
            that
          </li>
          <li className="flex items-center gap-2">
            <Check className="size-4 text-success" /> AI answering, booking, SMS/email delivery
          </li>
        </ul>
        <div className="flex items-center gap-2 border-t border-border pt-3">
          <Switch id="annual-toggle" checked={annual} onCheckedChange={onToggleAnnual} />
          <Label htmlFor="annual-toggle" className="text-sm font-normal">
            Prepay annually and save {annualDiscountPct}%
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}
