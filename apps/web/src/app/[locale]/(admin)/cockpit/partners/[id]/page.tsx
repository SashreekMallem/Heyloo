"use client";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@heyloo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { toast } from "sonner";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

const VERTICALS = [
  "auto",
  "vet",
  "legal",
  "dental",
  "real_estate",
  "motel",
  "restaurant",
  "generic",
] as const;

interface Partner {
  id: string;
  name: string;
  email: string;
  rate_bps: number | null;
  commission_base: "gross_profit" | "revenue";
  duration_months: number | null;
}

interface Override {
  vertical: string;
  rate_bps: number | null;
  commission_base: "gross_profit" | "revenue" | null;
  duration_months: number | null;
}

interface PartnerDetail {
  partner: Partner;
  overrides: Override[];
}

function TermsForm({
  title,
  initial,
  onSave,
  onClear,
}: {
  title: string;
  initial: {
    rate_bps: number | null;
    commission_base: string | null;
    duration_months: number | null;
  };
  onSave: (v: {
    rate_bps: number | null;
    commission_base: "gross_profit" | "revenue" | null;
    duration_months: number | null;
  }) => Promise<void>;
  onClear?: () => Promise<void>;
}) {
  const [ratePct, setRatePct] = useState(
    initial.rate_bps != null ? String(initial.rate_bps / 100) : "",
  );
  const [base, setBase] = useState<string>(initial.commission_base ?? "");
  const [duration, setDuration] = useState(
    initial.duration_months != null ? String(initial.duration_months) : "",
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    const pct = ratePct.trim() === "" ? null : Number.parseFloat(ratePct);
    if (pct != null && (Number.isNaN(pct) || pct < 0 || pct > 100)) {
      toast.error("Rate must be between 0 and 100%.");
      return;
    }
    const months = duration.trim() === "" ? null : Number.parseInt(duration, 10);
    setSaving(true);
    await onSave({
      rate_bps: pct != null ? Math.round(pct * 100) : null,
      commission_base: (base || null) as "gross_profit" | "revenue" | null,
      duration_months: months,
    });
    setSaving(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor={`${title}-rate`}>Rate (%)</Label>
            <Input
              id={`${title}-rate`}
              type="number"
              step="0.01"
              placeholder="No recurring commission"
              value={ratePct}
              onChange={(e) => setRatePct(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${title}-base`}>Base</Label>
            <Select value={base || undefined} onValueChange={setBase}>
              <SelectTrigger id={`${title}-base`}>
                <SelectValue placeholder="Inherit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gross_profit">Gross profit</SelectItem>
                <SelectItem value="revenue">Revenue</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${title}-duration`}>Duration (months)</Label>
            <Input
              id={`${title}-duration`}
              type="number"
              placeholder="Lifetime"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving}>
            Save
          </Button>
          {onClear && (
            <Button variant="outline" onClick={onClear} disabled={saving}>
              Clear override
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminPartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const query = useAdminQuery<PartnerDetail>(
    "referral_partner",
    [id],
    `admin-referral-partners/${id}`,
  );

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["admin", "referral_partner", id] });
  }

  async function savePartnerTerms(v: {
    rate_bps: number | null;
    commission_base: "gross_profit" | "revenue" | null;
    duration_months: number | null;
  }) {
    const res = await fetch(`/api/admin/admin-referral-partners/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...v, commission_base: v.commission_base ?? "gross_profit" }),
    });
    if (res.ok) {
      toast.success("Saved");
      invalidate();
    } else {
      toast.error("Couldn't save — please try again.");
    }
  }

  async function saveOverride(
    vertical: string,
    v: {
      rate_bps: number | null;
      commission_base: "gross_profit" | "revenue" | null;
      duration_months: number | null;
    },
  ) {
    const res = await fetch(`/api/admin/admin-referral-partners/${id}/overrides/${vertical}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(v),
    });
    if (res.ok) {
      toast.success(`${vertical} override saved`);
      invalidate();
    } else {
      toast.error("Couldn't save — please try again.");
    }
  }

  async function clearOverride(vertical: string) {
    const res = await fetch(`/api/admin/admin-referral-partners/${id}/overrides/${vertical}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success(`${vertical} override cleared`);
      invalidate();
    } else {
      toast.error("Couldn't clear — please try again.");
    }
  }

  return (
    <DataState
      query={query}
      empty={{ title: "Partner not found" }}
      render={(data) => {
        const overrideByVertical = new Map(data.overrides.map((o) => [o.vertical, o]));
        return (
          <div className="max-w-2xl space-y-6">
            <div>
              <h1 className="text-xl font-semibold">{data.partner.name}</h1>
              <p className="text-sm text-muted-foreground">{data.partner.email}</p>
            </div>

            <TermsForm
              title="Default commission terms"
              initial={data.partner}
              onSave={savePartnerTerms}
            />

            <div>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                Per-vertical overrides — any field left blank inherits the default above
              </h2>
              <div className="space-y-3">
                {VERTICALS.map((v) => {
                  const existing = overrideByVertical.get(v);
                  return (
                    <TermsForm
                      key={v}
                      title={v}
                      initial={
                        existing ?? { rate_bps: null, commission_base: null, duration_months: null }
                      }
                      onSave={(terms) => saveOverride(v, terms)}
                      onClear={existing ? () => clearOverride(v) : undefined}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        );
      }}
    />
  );
}
