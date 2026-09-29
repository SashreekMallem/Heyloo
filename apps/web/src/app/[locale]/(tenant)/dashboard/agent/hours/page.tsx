"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { BookingRulesResponse } from "@/app/api/tenant/settings/booking-rules/route";
import { NotLiveNote } from "@/components/tenant/settings/not-live-note";
import { WeeklyHoursEditor } from "@/components/tenant/settings/weekly-hours-editor";
import { Link } from "@/i18n/navigation";
import { saveErrorMessage, sendJson } from "@/lib/settings/client";
import {
  exceptionsFromStored,
  type HoursPayload,
  hoursPayloadSchema,
  scheduleFromStored,
} from "@/lib/settings/hours";
import { currentTimeIn } from "@/lib/settings/timezone";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

interface HoursRow {
  business_hours: unknown;
  hours_exceptions: unknown;
  timezone: string;
  vertical: string;
}

/**
 * Agent → Hours (SETTINGS-1). Reads the stored hours tolerantly (every
 * legacy shape), validates on the client AND in
 * `POST /api/tenant/settings/hours`, which stores the canonical shape and
 * rebuilds bookable times immediately — see `lib/settings/hours.ts`.
 */
export default function HoursTabPage() {
  const tenantId = useCurrentTenantId();

  const query = useQuery({
    queryKey: ["tenant", tenantId, "tenants", "hours"],
    queryFn: async (): Promise<HoursRow | null> => {
      const { data } = await supabaseBrowserClient
        .from("tenants")
        .select("business_hours, hours_exceptions, timezone, vertical")
        .eq("id", tenantId as string)
        .maybeSingle();
      return (data as HoursRow | null) ?? null;
    },
    enabled: !!tenantId,
  });

  if (!tenantId || !query.data) return null;
  return (
    <div className="space-y-6">
      <HoursCard tenantId={tenantId} row={query.data} />
      <BookingRulesCard tenantId={tenantId} vertical={query.data.vertical} />
    </div>
  );
}

function HoursCard({ tenantId, row }: { tenantId: string; row: HoursRow }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState<HoursPayload>(() => ({
    hours: scheduleFromStored(row.business_hours),
    exceptions: exceptionsFromStored(row.hours_exceptions),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const localTime = currentTimeIn(row.timezone);

  async function save() {
    const parsed = hoursPayloadSchema.safeParse(value);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [issue.path.join("."), issue.message]),
        ),
      );
      toast.error("Please fix the highlighted hours.");
      return;
    }
    setErrors({});
    setSaving(true);
    const result = await sendJson<{ availability: { resources: number; failed: number } | null }>(
      "/api/tenant/settings/hours",
      parsed.data,
    );
    setSaving(false);
    if (!result.ok) {
      setErrors(Object.fromEntries(result.issues.map((i) => [i.path.join("."), i.message])));
      toast.error(saveErrorMessage(result));
      return;
    }
    const availability = result.body?.availability ?? null;
    if (availability && availability.failed > 0) {
      toast.success("Saved — some bookable times will finish updating overnight.");
    } else if (availability) {
      toast.success("Saved — your bookable times are updated now.");
    } else {
      toast.success("Saved — callers hear your new hours from the next call.");
    }
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "tenants"] });
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "settings_checklist"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business hours</CardTitle>
        <CardDescription>
          Your AI only offers appointment times inside these hours and tells callers when
          you&apos;re open. Times are in <strong>{row.timezone}</strong>
          {localTime ? ` (${localTime} there now)` : ""} —{" "}
          <Link href="/dashboard/agent/business" className="underline">
            change time zone
          </Link>
          .
          {row.vertical === "motel"
            ? " Rooms stay bookable every night; these hours are when the front desk answers."
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <WeeklyHoursEditor value={value} onChange={setValue} errors={errors} disabled={saving} />
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save hours"}
        </Button>
      </CardContent>
    </Card>
  );
}

const NOTICE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "default", label: "Platform default" },
  { value: "0", label: "No minimum" },
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "120", label: "2 hours" },
  { value: "240", label: "4 hours" },
  { value: "720", label: "12 hours" },
  { value: "1440", label: "1 day" },
  { value: "2880", label: "2 days" },
];

const HORIZON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "default", label: "Platform default" },
  { value: "7", label: "1 week" },
  { value: "14", label: "2 weeks" },
  { value: "21", label: "3 weeks" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "6 months" },
  { value: "365", label: "1 year" },
];

function optionValue(value: number | null, options: Array<{ value: string }>): string {
  if (value === null) return "default";
  const match = options.find((option) => option.value === String(value));
  return match ? match.value : "default";
}

function BookingRulesCard({ tenantId, vertical }: { tenantId: string; vertical: string }) {
  const query = useQuery({
    queryKey: ["tenant", tenantId, "tenants", "booking_rules"],
    queryFn: async (): Promise<BookingRulesResponse | null> => {
      const res = await fetch("/api/tenant/settings/booking-rules");
      return res.ok ? ((await res.json()) as BookingRulesResponse) : null;
    },
  });
  if (!query.data) return null;
  return <BookingRulesForm tenantId={tenantId} vertical={vertical} initial={query.data} />;
}

function BookingRulesForm({
  tenantId,
  vertical,
  initial,
}: {
  tenantId: string;
  vertical: string;
  initial: BookingRulesResponse;
}) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState(() =>
    optionValue(initial.min_notice_minutes, NOTICE_OPTIONS),
  );
  const [horizon, setHorizon] = useState(() => optionValue(initial.horizon_days, HORIZON_OPTIONS));
  const [saving, setSaving] = useState(false);
  const defaultNotice = vertical === "restaurant" ? "15 minutes" : "30 minutes";
  const defaultHorizon = vertical === "motel" ? "30 days" : "21 days";

  async function save() {
    setSaving(true);
    const result = await sendJson("/api/tenant/settings/booking-rules", {
      min_notice_minutes: notice === "default" ? null : Number(notice),
      horizon_days: horizon === "default" ? null : Number(horizon),
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(saveErrorMessage(result));
      return;
    }
    toast.success("Saved.");
    void queryClient.invalidateQueries({
      queryKey: ["tenant", tenantId, "tenants", "booking_rules"],
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Booking window</CardTitle>
        <CardDescription>
          How soon and how far ahead callers can book. By default your AI allows bookings from{" "}
          {defaultNotice} ahead, up to {defaultHorizon} out.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!initial.available ? (
          <p className="text-sm text-muted-foreground">
            Custom booking windows arrive with the next platform update.
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="booking-min-notice">Minimum notice</Label>
                <Select value={notice} onValueChange={setNotice}>
                  <SelectTrigger id="booking-min-notice">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NOTICE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="booking-horizon">Book up to</Label>
                <Select value={horizon} onValueChange={setHorizon}>
                  <SelectTrigger id="booking-horizon">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HORIZON_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <NotLiveNote>
              Your AI keeps using the defaults above until custom booking windows are switched on
              for your account. What you choose here is kept and applies automatically then.
            </NotLiveNote>
            <Button variant="outline" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save booking window"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
