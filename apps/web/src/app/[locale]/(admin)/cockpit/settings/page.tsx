"use client";

import {
  adminReferralSettingSchema,
  platformPricingTableSchema,
  VERTICALS,
} from "@heyloo/canonical-types";
import {
  Button,
  CentsInput,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@heyloo/ui";
import { useState } from "react";
import { toast } from "sonner";

export default function PlatformSettingsPage() {
  const [flatAmount, setFlatAmount] = useState<number | undefined>(10000);
  const [rule, setRule] = useState("$100 after their 2nd paid month");

  const [vertical, setVertical] = useState<(typeof VERTICALS)[number]>("generic");
  const [baseCents, setBaseCents] = useState<number | undefined>(29900);
  const [includedMinutes, setIncludedMinutes] = useState(300);
  const [overageCents, setOverageCents] = useState<number | undefined>(40);

  async function saveReferral() {
    const parsed = adminReferralSettingSchema.safeParse({
      flat_amount_cents: flatAmount,
      qualification_rule: rule,
    });
    if (!parsed.success) {
      toast.error("Check the referral settings.");
      return;
    }
    const res = await fetch("/api/admin/admin-platform-settings/referral", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    toast[res.ok ? "success" : "error"](
      res.ok ? "Saved" : "Not available yet — backend endpoint pending.",
    );
  }

  async function savePricing() {
    const parsed = platformPricingTableSchema.safeParse({
      vertical,
      base_cents: baseCents,
      included_minutes: includedMinutes,
      overage_cents: overageCents,
      effective_at: new Date().toISOString(),
    });
    if (!parsed.success) {
      toast.error("Check the pricing inputs.");
      return;
    }
    const res = await fetch("/api/admin/admin-platform-settings/pricing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    toast[res.ok ? "success" : "error"](
      res.ok ? "New price version created" : "Not available yet — backend endpoint pending.",
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-semibold">Platform settings</h1>
      <Tabs defaultValue="referral">
        <TabsList>
          <TabsTrigger value="referral">Referral</TabsTrigger>
          <TabsTrigger value="pricing">Pricing tables</TabsTrigger>
        </TabsList>
        <TabsContent value="referral" className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="referral-flat-amount" className="text-sm font-medium">
              Flat referral amount
            </label>
            <CentsInput id="referral-flat-amount" value={flatAmount} onChange={setFlatAmount} />
          </div>
          <div className="space-y-1">
            <label htmlFor="referral-qualification-rule" className="text-sm font-medium">
              Qualification rule
            </label>
            <Textarea
              id="referral-qualification-rule"
              value={rule}
              onChange={(e) => setRule(e.target.value)}
            />
          </div>
          <Button onClick={saveReferral}>Save</Button>
        </TabsContent>
        <TabsContent value="pricing" className="space-y-4">
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={vertical}
            onChange={(e) => setVertical(e.target.value as (typeof VERTICALS)[number])}
          >
            {VERTICALS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <div className="space-y-1">
            <label htmlFor="pricing-base-cents" className="text-sm font-medium">
              Base price
            </label>
            <CentsInput id="pricing-base-cents" value={baseCents} onChange={setBaseCents} />
          </div>
          <div className="space-y-1">
            <label htmlFor="pricing-included-minutes" className="text-sm font-medium">
              Included minutes
            </label>
            <Input
              id="pricing-included-minutes"
              type="number"
              value={includedMinutes}
              onChange={(e) => setIncludedMinutes(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="pricing-overage-cents" className="text-sm font-medium">
              Overage per minute
            </label>
            <CentsInput
              id="pricing-overage-cents"
              value={overageCents}
              onChange={setOverageCents}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Saving creates a NEW price version — existing tenants&apos; snapshotted versions are
            never mutated.
          </p>
          <Button onClick={savePricing}>Create new price version</Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}
