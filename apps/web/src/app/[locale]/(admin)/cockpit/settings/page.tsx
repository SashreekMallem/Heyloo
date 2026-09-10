"use client";

import {
  adminReferralSettingSchema,
  platformPricingTableSchema,
  VERTICALS,
} from "@heyloo/canonical-types";
import {
  Button,
  CentsInput,
  DataState,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@heyloo/ui";
import { useState } from "react";
import { toast } from "sonner";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface PriceCard {
  base_cents: number;
  included_minutes: number;
  overage_cents: number;
}

interface PlatformSettingsResponse {
  referral: { flat_amount_cents: number; qualification_rule: string };
  price_cards: Record<string, PriceCard | null>;
}

/**
 * Seeds its local editable state directly from the loaded `initial` prop
 * (no effect syncing async data into state — the parent only mounts this
 * once `settingsQuery.data` exists, per `DataState`, so `useState(initial)`
 * already reads the real row on first render; FRONTEND_AUDIT.md H9).
 */
function ReferralTab({
  initial,
  onSaved,
}: {
  initial: PlatformSettingsResponse["referral"];
  onSaved: () => void;
}) {
  const [flatAmount, setFlatAmount] = useState<number | undefined>(initial.flat_amount_cents);
  const [rule, setRule] = useState(initial.qualification_rule);

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
    if (res.ok) {
      toast.success("Saved");
      onSaved();
    } else {
      toast.error("Couldn't save — please try again.");
    }
  }

  return (
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
  );
}

/** Mounted with `key={vertical}` by the parent so switching verticals remounts with fresh seeded state instead of an effect. */
function PricingTab({
  vertical,
  onVerticalChange,
  initial,
  onSaved,
}: {
  vertical: (typeof VERTICALS)[number];
  onVerticalChange: (v: (typeof VERTICALS)[number]) => void;
  initial: PriceCard | null;
  onSaved: () => void;
}) {
  const [baseCents, setBaseCents] = useState<number | undefined>(initial?.base_cents);
  const [includedMinutes, setIncludedMinutes] = useState(initial?.included_minutes ?? 0);
  const [overageCents, setOverageCents] = useState<number | undefined>(initial?.overage_cents);

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
    if (res.ok) {
      toast.success("Price card updated");
      onSaved();
    } else {
      toast.error("Couldn't save — please try again.");
    }
  }

  return (
    <TabsContent value="pricing" className="space-y-4">
      <select
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        value={vertical}
        onChange={(e) => onVerticalChange(e.target.value as (typeof VERTICALS)[number])}
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
        <CentsInput id="pricing-overage-cents" value={overageCents} onChange={setOverageCents} />
      </div>
      <p className="text-xs text-muted-foreground">
        Updates the live price card for this vertical — every previous value is preserved in the
        audit trail (Admin actions), never silently lost.
      </p>
      <Button onClick={savePricing}>Save price card</Button>
    </TabsContent>
  );
}

export default function PlatformSettingsPage() {
  const settingsQuery = useAdminQuery<PlatformSettingsResponse>(
    "platform-settings",
    [],
    "admin-platform-settings",
  );
  const [vertical, setVertical] = useState<(typeof VERTICALS)[number]>("generic");

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-semibold">Platform settings</h1>
      <DataState
        query={settingsQuery}
        empty={{ title: "No platform settings found" }}
        render={(data) => (
          <Tabs defaultValue="referral">
            <TabsList>
              <TabsTrigger value="referral">Referral</TabsTrigger>
              <TabsTrigger value="pricing">Pricing tables</TabsTrigger>
            </TabsList>
            <ReferralTab initial={data.referral} onSaved={() => void settingsQuery.refetch()} />
            <PricingTab
              key={vertical}
              vertical={vertical}
              onVerticalChange={setVertical}
              initial={data.price_cards[vertical] ?? null}
              onSaved={() => void settingsQuery.refetch()}
            />
          </Tabs>
        )}
      />
    </div>
  );
}
