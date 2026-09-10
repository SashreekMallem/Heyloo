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
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
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
      <Select
        value={vertical}
        onValueChange={(v) => onVerticalChange(v as (typeof VERTICALS)[number])}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VERTICALS.map((v) => (
            <SelectItem key={v} value={v} className="capitalize">
              {v.replace(/_/g, " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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

interface VerticalFees {
  setup_fee_enabled: boolean;
  setup_fee_cents: number;
  white_glove_enabled: boolean;
  white_glove_fee_cents: number;
  white_glove_description: string;
}

const DEFAULT_VERTICAL_FEES: VerticalFees = {
  setup_fee_enabled: false,
  setup_fee_cents: 0,
  white_glove_enabled: false,
  white_glove_fee_cents: 0,
  white_glove_description: "",
};

/** Setup fee / white-glove onboarding fee, per vertical (Cluster H task brief item 5 — new product surface, docs/BUILD_NOTES.md). Mounted with `key={vertical}` so switching verticals remounts with freshly seeded state, same convention as `PricingTab`. */
function FeesTab({
  vertical,
  onVerticalChange,
  initial,
  onSaved,
}: {
  vertical: (typeof VERTICALS)[number];
  onVerticalChange: (v: (typeof VERTICALS)[number]) => void;
  initial: VerticalFees;
  onSaved: () => void;
}) {
  const [setupEnabled, setSetupEnabled] = useState(initial.setup_fee_enabled);
  const [setupCents, setSetupCents] = useState<number | undefined>(initial.setup_fee_cents);
  const [wgEnabled, setWgEnabled] = useState(initial.white_glove_enabled);
  const [wgCents, setWgCents] = useState<number | undefined>(initial.white_glove_fee_cents);
  const [wgDescription, setWgDescription] = useState(initial.white_glove_description);

  async function save() {
    const res = await fetch("/api/admin/admin-platform-settings/fees", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vertical,
        setup_fee_enabled: setupEnabled,
        setup_fee_cents: setupCents ?? 0,
        white_glove_enabled: wgEnabled,
        white_glove_fee_cents: wgCents ?? 0,
        white_glove_description: wgDescription,
      }),
    });
    if (res.ok) {
      toast.success("Fees saved");
      onSaved();
    } else {
      toast.error("Couldn't save — check the amounts and try again.");
    }
  }

  return (
    <TabsContent value="fees" className="space-y-4">
      <Select
        value={vertical}
        onValueChange={(v) => onVerticalChange(v as (typeof VERTICALS)[number])}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VERTICALS.map((v) => (
            <SelectItem key={v} value={v} className="capitalize">
              {v.replace(/_/g, " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2">
        <Switch id="setup-fee-enabled" checked={setupEnabled} onCheckedChange={setSetupEnabled} />
        <Label htmlFor="setup-fee-enabled" className="text-sm font-normal">
          Charge a one-time setup fee
        </Label>
      </div>
      <div className="space-y-1">
        <label htmlFor="setup-fee-cents" className="text-sm font-medium">
          Setup fee
        </label>
        <CentsInput id="setup-fee-cents" value={setupCents} onChange={setSetupCents} />
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-4">
        <Switch id="white-glove-enabled" checked={wgEnabled} onCheckedChange={setWgEnabled} />
        <Label htmlFor="white-glove-enabled" className="text-sm font-normal">
          Offer white-glove onboarding
        </Label>
      </div>
      <div className="space-y-1">
        <label htmlFor="white-glove-cents" className="text-sm font-medium">
          White-glove fee
        </label>
        <CentsInput id="white-glove-cents" value={wgCents} onChange={setWgCents} />
      </div>
      <div className="space-y-1">
        <label htmlFor="white-glove-description" className="text-sm font-medium">
          White-glove description (shown to the tenant)
        </label>
        <Textarea
          id="white-glove-description"
          value={wgDescription}
          onChange={(e) => setWgDescription(e.target.value)}
          placeholder="We'll build your menu, book your integrations, and QA the agent with you live."
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Shown at signup step 2 when enabled — a disabled fee is saved but never charged or shown.
      </p>
      <Button onClick={save}>Save fees</Button>
    </TabsContent>
  );
}

export default function PlatformSettingsPage() {
  const settingsQuery = useAdminQuery<PlatformSettingsResponse>(
    "platform-settings",
    [],
    "admin-platform-settings",
  );
  const feesQuery = useAdminQuery<{ fees: Record<string, VerticalFees> }>(
    "platform-fees",
    [],
    "admin-platform-settings/fees",
  );
  const [vertical, setVertical] = useState<(typeof VERTICALS)[number]>("generic");

  return (
    <div className="max-w-lg space-y-6">
      <PageHeader
        title="Platform settings"
        description="Referral defaults, per-vertical pricing, and setup/white-glove fees."
      />
      <DataState
        query={settingsQuery}
        empty={{ title: "No platform settings found" }}
        render={(data) => (
          <Tabs defaultValue="referral">
            <TabsList>
              <TabsTrigger value="referral">Referral</TabsTrigger>
              <TabsTrigger value="pricing">Pricing tables</TabsTrigger>
              <TabsTrigger value="fees">Fees</TabsTrigger>
            </TabsList>
            <ReferralTab
              initial={data.referral ?? { flat_amount_cents: 0, qualification_rule: "" }}
              onSaved={() => void settingsQuery.refetch()}
            />
            <PricingTab
              key={vertical}
              vertical={vertical}
              onVerticalChange={setVertical}
              initial={data.price_cards?.[vertical] ?? null}
              onSaved={() => void settingsQuery.refetch()}
            />
            {feesQuery.data && (
              <FeesTab
                key={`fees-${vertical}`}
                vertical={vertical}
                onVerticalChange={setVertical}
                initial={feesQuery.data?.fees?.[vertical] ?? DEFAULT_VERTICAL_FEES}
                onSaved={() => void feesQuery.refetch()}
              />
            )}
          </Tabs>
        )}
      />
    </div>
  );
}
