"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import {
  Badge,
  BookingCalendar,
  type BookingCalendarEntry,
  type BookingCalendarView,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataState,
  formatPhoneDisplay,
  PageHeader,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  StatusBadge,
  startOfMonthGrid,
  ToggleGroup,
  ToggleGroupItem,
} from "@heyloo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { CustomAnswersList } from "@/components/tenant/custom-answers";
import { Link, useRouter } from "@/i18n/navigation";
import { tenantQueryKey, useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { customerNotifiedToast, paymentLinkResentToast } from "@/lib/messaging/texting-copy";
import { useTextingOn } from "@/lib/messaging/use-texting-on";
import { readCustomAnswers, withoutCustomAnswers } from "@/lib/settings/custom-questions";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";
import { tenantDayStartIso } from "@/lib/tenant/tz";
import { parseTstzrange } from "@/lib/tstzrange";

interface BookingDetail {
  resourceId: string | null;
  customerPhone: string | null;
  partySize: number | null;
  structuredPayload: Record<string, unknown>;
  quotedRateCents: number | null;
  identityVerifiedBy: "phone_match" | "knowledge" | null;
  consent: { sms?: boolean; call?: boolean; captured_at?: string } | null;
  paymentLink: {
    id: string;
    amountCents: number;
    purpose: string;
    status: string;
  } | null;
}

/** `bookings.structured_payload` is a per-vertical loose object
 * (`@heyloo/canonical-types`'s `zBookingStructuredPayloadFor`) — the
 * dashboard renders whatever keys a given booking actually has rather than
 * forking per vertical (GAP_REGISTER.md §1.11: "a single, mechanical,
 * cross-vertical dashboard task — do not fork it per vertical"). */
function structuredPayloadEntries(payload: Record<string, unknown>): [string, string][] {
  return Object.entries(payload)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]): [string, string] => [
      k.replace(/_/g, " "),
      Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v),
    ]);
}

interface SlotOption {
  id: string;
  start: string;
}

/** Statuses a booking can still be confirmed / rescheduled / cancelled from. */
const ACTIONABLE_STATUSES = new Set(["scheduled", "confirmed"]);

const PAST_PAGE_SIZE = 25;
/** Upper bound on the "upcoming" list / a calendar month, so one query can never run away. */
const WINDOW_LIMIT = 500;
const SLOT_LIMIT = 60;

type BookingScope = "upcoming" | "past";

interface BookingsResult {
  entries: BookingCalendarEntry[];
  total: number;
}

/** Slots grouped per calendar day for the reschedule picker ("Mon, Sep 21" -> times). */
export function groupSlotsByDay(slots: SlotOption[]): { day: string; slots: SlotOption[] }[] {
  const groups = new Map<string, SlotOption[]>();
  for (const slot of slots) {
    const day = new Date(slot.start).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const list = groups.get(day) ?? [];
    list.push(slot);
    groups.set(day, list);
  }
  return [...groups.entries()].map(([day, list]) => ({ day, slots: list }));
}

interface WaitlistRow {
  id: string;
  customerName: string;
  windowStart: string | null;
  createdAt: string;
}

const PAYMENT_STATUS_VARIANT: Record<string, "outline" | "secondary" | "success" | "destructive"> =
  {
    pending: "outline",
    sent: "secondary",
    paid: "success",
    expired: "destructive",
    cancelled: "destructive",
  };

export default function BookingsPage() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();
  // MSG-3: never claim a customer was texted unless carriers approved texting.
  const textingOn = useTextingOn(tenantId);
  const router = useRouter();
  const bookingParam = useSearchParams()?.get("booking") ?? null;
  const [view, setView] = useState<BookingCalendarView>("list");
  const [scope, setScope] = useState<BookingScope>("upcoming");
  const [pastPage, setPastPage] = useState(0);
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState<BookingCalendarEntry | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [resendingLink, setResendingLink] = useState(false);

  // "Today" is the tenant's local day, not the browser's or UTC's.
  const tzQuery = useTenantQuery(
    tenantId ?? "",
    "tenant_timezone",
    [],
    async (): Promise<string> => {
      const { data } = await supabaseBrowserClient
        .from("tenants")
        .select("timezone")
        .eq("id", tenantId as string)
        .maybeSingle();
      return data?.timezone ?? "UTC";
    },
    { enabled: !!tenantId },
  );
  const tenantTz = tzQuery.data ?? "UTC";

  const monthKey = `${month.getFullYear()}-${month.getMonth()}`;

  const query = useTenantQuery(
    tenantId ?? "",
    "bookings",
    [view, scope, pastPage, monthKey, tenantTz],
    async (): Promise<BookingsResult> => {
      // Windowed, ordered queries (QA-1 F-08): the old "oldest 200 bookings, no
      // date window" query showed past bookings first and silently dropped the
      // newest ones once a tenant passed 200 bookings.
      //   calendar        -> exactly the visible 6-week grid
      //   list / upcoming -> from the start of the tenant's today, soonest first
      //   list / past     -> before today, newest first, paginated
      // Two flat queries rather than an embedded `customers(name)` select —
      // the hand-maintained Database type has no `Relationships` metadata
      // (packages/supabase-client/src/database.types.ts), so FK-embedded
      // selects don't type-check against it.
      let q = supabaseBrowserClient
        .from("bookings")
        .select("id, start_at, status, customer_id", { count: "exact" })
        .eq("tenant_id", tenantId as string)
        // CALL-6 (docs/BUILD_NOTES.md): never show a Retell batch-test/
        // simulator booking on the tenant's real bookings list.
        .eq("is_test", false);

      if (view === "calendar") {
        const grid = startOfMonthGrid(month);
        const first = grid[0] as Date;
        const last = grid[grid.length - 1] as Date;
        const gridEnd = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
        q = q
          .gte("start_at", first.toISOString())
          .lt("start_at", gridEnd.toISOString())
          .order("start_at", { ascending: true })
          .limit(WINDOW_LIMIT);
      } else if (scope === "upcoming") {
        q = q
          .gte("start_at", tenantDayStartIso(tenantTz))
          .order("start_at", { ascending: true })
          .limit(WINDOW_LIMIT);
      } else {
        q = q
          .lt("start_at", tenantDayStartIso(tenantTz))
          .order("start_at", { ascending: false })
          .range(pastPage * PAST_PAGE_SIZE, pastPage * PAST_PAGE_SIZE + PAST_PAGE_SIZE - 1);
      }

      const { data: bookings, count, error } = await q;
      if (error) throw new Error(error.message);

      const customerIds = [
        ...new Set((bookings ?? []).map((b) => b.customer_id).filter((id): id is string => !!id)),
      ];
      const { data: customers } = customerIds.length
        ? await supabaseBrowserClient.from("customers").select("id, name").in("id", customerIds)
        : { data: [] as { id: string; name: string | null }[] };
      const nameById = new Map((customers ?? []).map((c) => [c.id, c.name]));

      return {
        total: count ?? (bookings ?? []).length,
        entries: (bookings ?? []).map((b) => ({
          id: b.id,
          startAt: b.start_at,
          status: b.status,
          customerName: (b.customer_id && nameById.get(b.customer_id)) ?? null,
        })),
      };
    },
    { enabled: !!tenantId && tzQuery.isFetched },
  );

  // Deep link `/dashboard/bookings?booking=<id>` (notification bell, call detail):
  // load that one booking directly so it opens even when it is outside the list window.
  const deepLinkQuery = useTenantQuery(
    tenantId ?? "",
    "booking_deeplink",
    [bookingParam ?? ""],
    async (): Promise<BookingCalendarEntry | null> => {
      const { data: b } = await supabaseBrowserClient
        .from("bookings")
        .select("id, start_at, status, customer_id")
        .eq("tenant_id", tenantId as string)
        .eq("id", bookingParam as string)
        .maybeSingle();
      if (!b) return null;
      const { data: customer } = b.customer_id
        ? await supabaseBrowserClient
            .from("customers")
            .select("name")
            .eq("id", b.customer_id)
            .maybeSingle()
        : { data: null };
      return {
        id: b.id,
        startAt: b.start_at,
        status: b.status,
        customerName: customer?.name ?? null,
      };
    },
    { enabled: !!tenantId && !!bookingParam },
  );
  const active: BookingCalendarEntry | null =
    selected ?? (bookingParam ? (deepLinkQuery.data ?? null) : null);

  const detailQuery = useTenantQuery(
    tenantId ?? "",
    "booking_detail",
    [active?.id ?? ""],
    async (): Promise<BookingDetail> => {
      const bookingId = active?.id as string;
      const [{ data: booking }, { data: paymentLink }] = await Promise.all([
        supabaseBrowserClient
          .from("bookings")
          // `quoted_rate_cents` (motel) is a real column not yet on the
          // hand-maintained `BookingRow` type (docs/audit/FIX_REQUESTS.md) —
          // select-string isn't statically checked against it, so this
          // reads the live column today rather than waiting.
          .select(
            "resource_id, customer_id, party_size, structured_payload, quoted_rate_cents, identity_verified_by",
          )
          .eq("id", bookingId)
          .eq("tenant_id", tenantId as string)
          .maybeSingle(),
        supabaseBrowserClient
          .from("payment_links")
          .select("id, amount_cents, purpose, status")
          .eq("booking_id", bookingId)
          .eq("tenant_id", tenantId as string)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const row = booking as unknown as {
        resource_id: string | null;
        customer_id: string | null;
        party_size: number | null;
        structured_payload: Record<string, unknown> | null;
        quoted_rate_cents: number | null;
        identity_verified_by: "phone_match" | "knowledge" | null;
      } | null;
      const { data: customer } = row?.customer_id
        ? await supabaseBrowserClient
            .from("customers")
            .select("phone_e164, consent")
            .eq("id", row.customer_id)
            .maybeSingle()
        : { data: null };
      return {
        resourceId: row?.resource_id ?? null,
        customerPhone: customer?.phone_e164 ?? null,
        partySize: row?.party_size ?? null,
        structuredPayload: row?.structured_payload ?? {},
        quotedRateCents: row?.quoted_rate_cents ?? null,
        identityVerifiedBy: row?.identity_verified_by ?? null,
        consent: customer?.consent ?? null,
        paymentLink: paymentLink
          ? {
              id: paymentLink.id,
              amountCents: paymentLink.amount_cents,
              purpose: paymentLink.purpose,
              status: paymentLink.status,
            }
          : null,
      };
    },
    { enabled: !!active && !!tenantId },
  );

  const slotsQuery = useTenantQuery(
    tenantId ?? "",
    "reschedule_slots",
    [detailQuery.data?.resourceId ?? ""],
    async (): Promise<SlotOption[]> => {
      const { data } = await supabaseBrowserClient
        .from("availability_slots")
        .select("id, slot_range")
        .eq("tenant_id", tenantId as string)
        .eq("resource_id", detailQuery.data?.resourceId as string)
        .eq("is_available", true)
        // Only slots that start from now on: `fn_regenerate_availability_slots`
        // keeps ended slots as history, so without this the picker listed 150+
        // past slots first (QA-1 F-07). `rangeGte` = PostgREST `nxl` (`&>`, "does
        // not extend to the left of"): lower(slot_range) >= now.
        .rangeGte("slot_range", `[${new Date().toISOString()},)`)
        .order("slot_range", { ascending: true })
        .limit(SLOT_LIMIT);
      const options: SlotOption[] = [];
      for (const s of data ?? []) {
        const range = parseTstzrange(s.slot_range);
        if (range) options.push({ id: s.id, start: range.start });
      }
      return options;
    },
    { enabled: rescheduling && !!detailQuery.data?.resourceId },
  );

  const waitlistQuery = useTenantQuery(
    tenantId ?? "",
    "waitlist_entries",
    [],
    async (): Promise<WaitlistRow[]> => {
      const { data: entries } = await supabaseBrowserClient
        .from("waitlist_entries")
        .select("id, customer_id, window, created_at")
        .eq("tenant_id", tenantId as string)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(50);
      const customerIds = [...new Set((entries ?? []).map((e) => e.customer_id))];
      const { data: customers } = customerIds.length
        ? await supabaseBrowserClient
            .from("customers")
            .select("id, name, phone_e164")
            .in("id", customerIds)
        : { data: [] as { id: string; name: string | null; phone_e164: string }[] };
      const byId = new Map((customers ?? []).map((c) => [c.id, c]));
      return (entries ?? []).map((e) => {
        const customer = byId.get(e.customer_id);
        const range = parseTstzrange(e.window);
        return {
          id: e.id,
          customerName:
            customer?.name ??
            (customer?.phone_e164 ? formatPhoneDisplay(customer.phone_e164) : "Unknown customer"),
          windowStart: range?.start ?? null,
          createdAt: e.created_at,
        };
      });
    },
    { enabled: !!tenantId },
  );

  function closeSheet() {
    setSelected(null);
    setRescheduling(false);
    // Drop `?booking=` so a closed deep-linked sheet stays closed.
    if (bookingParam) router.replace("/dashboard/bookings");
  }

  async function runAction(action: "confirm" | "cancel") {
    if (!active) return;
    const res = await fetch(`/api/tenant/bookings/${active.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = (await res.json()) as { ok?: boolean; sms_queued?: boolean; error?: string };
    if (!res.ok || !body.ok) {
      toast.error("Something went wrong — please try again.");
      return;
    }
    toast.success(customerNotifiedToast({ textingOn, smsQueued: body.sms_queued === true }));
    closeSheet();
    if (tenantId)
      void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "bookings"] });
  }

  async function pickSlot(slotId: string) {
    if (!active || !tenantId) return;
    const res = await fetch(`/api/tenant/bookings/${active.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reschedule", new_slot_id: slotId }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      sms_queued?: boolean;
      error?: string;
    };
    // 409 is also "the booking is no longer live" (invalid_status) — not a taken slot.
    if (res.status === 409 && body.error !== "invalid_status") {
      toast.error("That slot was just taken — pick another.");
      void queryClient.invalidateQueries({
        queryKey: tenantQueryKey(tenantId, "reschedule_slots", detailQuery.data?.resourceId ?? ""),
      });
      return;
    }
    if (!res.ok || !body.ok) {
      toast.error("Something went wrong — please try again.");
      return;
    }
    toast.success(customerNotifiedToast({ textingOn, smsQueued: body.sms_queued === true }));
    closeSheet();
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "bookings"] });
  }

  async function resendPaymentLink() {
    const link = detailQuery.data?.paymentLink;
    if (!link || !tenantId) return;
    setResendingLink(true);
    const res = await fetch(`/api/tenant/payment-links/${link.id}/resend`, { method: "POST" });
    setResendingLink(false);
    if (!res.ok) {
      toast.error("Couldn't resend the payment link — please try again shortly.");
      return;
    }
    toast.success(paymentLinkResentToast({ textingOn }));
    void queryClient.invalidateQueries({
      queryKey: tenantQueryKey(tenantId, "booking_detail", active?.id ?? ""),
    });
  }

  async function removeFromWaitlist(id: string) {
    if (!tenantId) return;
    const res = await fetch(`/api/tenant/waitlist/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "expired" }),
    });
    if (!res.ok) {
      toast.error("Couldn't update — please try again.");
      return;
    }
    toast.success("Removed from waitlist");
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "waitlist_entries"] });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bookings"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {view === "list" && (
              <ToggleGroup
                type="single"
                variant="outline"
                value={scope}
                onValueChange={(v) => {
                  if (!v) return;
                  setScope(v as BookingScope);
                  setPastPage(0);
                }}
              >
                <ToggleGroupItem value="upcoming" aria-label="Upcoming bookings">
                  Upcoming
                </ToggleGroupItem>
                <ToggleGroupItem value="past" aria-label="Past bookings">
                  Past
                </ToggleGroupItem>
              </ToggleGroup>
            )}
            <ToggleGroup
              type="single"
              variant="outline"
              value={view}
              onValueChange={(v) => v && setView(v as BookingCalendarView)}
            >
              <ToggleGroupItem value="list" aria-label="List view">
                List
              </ToggleGroupItem>
              <ToggleGroupItem value="calendar" aria-label="Calendar view">
                Calendar
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        }
      />

      <DataState
        query={query}
        empty={{
          title: scope === "past" ? "No past bookings" : "No upcoming bookings",
          description:
            scope === "past"
              ? "Bookings from before today will show up here."
              : "Confirmed bookings will show up here.",
          // The calendar always renders its grid (an empty month still needs the month controls).
          isEmpty: (data) => view === "list" && data.entries.length === 0,
        }}
        render={(data) => (
          <div className="space-y-3">
            <BookingCalendar
              bookings={data.entries}
              view={view}
              onViewChange={setView}
              onSelect={setSelected}
              onMonthChange={setMonth}
              listOrder={scope === "past" ? "desc" : "asc"}
            />
            {view === "list" && scope === "past" && (
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pastPage === 0}
                  onClick={() => setPastPage((p) => Math.max(0, p - 1))}
                >
                  Newer
                </Button>
                <span>
                  Page {pastPage + 1} of {Math.max(1, Math.ceil(data.total / PAST_PAGE_SIZE))}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={(pastPage + 1) * PAST_PAGE_SIZE >= data.total}
                  onClick={() => setPastPage((p) => p + 1)}
                >
                  Older
                </Button>
              </div>
            )}
            {view === "list" && scope === "upcoming" && data.total > data.entries.length && (
              <p className="text-xs text-muted-foreground">
                Showing the next {data.entries.length} of {data.total} upcoming bookings.
              </p>
            )}
          </div>
        )}
      />

      <Card>
        <CardHeader>
          <CardTitle>Waitlist</CardTitle>
        </CardHeader>
        <CardContent>
          <DataState
            query={waitlistQuery}
            empty={{
              title: "No one's waiting",
              description:
                "Customers offered a waitlist spot when nothing was available show up here.",
            }}
            render={(entries) => (
              <ul className="divide-y divide-border">
                {entries.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <p className="text-sm font-medium">{entry.customerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.windowStart
                          ? `Wants ${new Date(entry.windowStart).toLocaleString()}`
                          : "Open window"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => removeFromWaitlist(entry.id)}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          />
        </CardContent>
      </Card>

      <Sheet open={!!active} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{active?.customerName ?? "Booking"}</SheetTitle>
          </SheetHeader>
          {active && (
            <div className="mt-4 space-y-4">
              <StatusBadge variant="booking" value={active.status} />
              <p className="text-sm text-muted-foreground">
                {new Date(active.startAt).toLocaleString()}
              </p>
              {detailQuery.data?.customerPhone && (
                <Link
                  href={`/dashboard/messages/${encodeURIComponent(detailQuery.data.customerPhone)}`}
                  className="text-sm text-accent-text underline underline-offset-2"
                >
                  Message this customer
                </Link>
              )}

              <div className="flex flex-wrap gap-2">
                {detailQuery.data?.identityVerifiedBy && (
                  <Badge variant="secondary">
                    Identity verified —{" "}
                    {detailQuery.data.identityVerifiedBy === "phone_match"
                      ? "phone match"
                      : "knowledge check"}
                  </Badge>
                )}
                {detailQuery.data?.consent?.sms || detailQuery.data?.consent?.call ? (
                  <Badge variant="success">
                    Consent on file
                    {detailQuery.data.consent.sms && detailQuery.data.consent.call
                      ? " (SMS + call)"
                      : detailQuery.data.consent.sms
                        ? " (SMS)"
                        : " (call)"}
                  </Badge>
                ) : detailQuery.data && !detailQuery.isLoading ? (
                  <Badge variant="outline">No consent on file</Badge>
                ) : null}
              </div>

              {detailQuery.data?.partySize != null && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Party size</span>{" "}
                  {detailQuery.data.partySize}
                </p>
              )}

              {detailQuery.data?.quotedRateCents != null && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Quoted rate</span>{" "}
                  {formatCentsUSD(detailQuery.data.quotedRateCents)}/night
                </p>
              )}

              {detailQuery.data &&
                readCustomAnswers(detailQuery.data.structuredPayload).length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Answers to your questions
                    </p>
                    <div className="rounded-md border border-border p-2">
                      <CustomAnswersList payload={detailQuery.data.structuredPayload} />
                    </div>
                  </div>
                )}

              {detailQuery.data &&
                structuredPayloadEntries(withoutCustomAnswers(detailQuery.data.structuredPayload))
                  .length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Captured on the call
                    </p>
                    <dl className="space-y-1 rounded-md border border-border p-2 text-sm">
                      {structuredPayloadEntries(
                        withoutCustomAnswers(detailQuery.data.structuredPayload),
                      ).map(([label, value]) => (
                        <div key={label} className="flex justify-between gap-2">
                          <dt className="capitalize text-muted-foreground">{label}</dt>
                          <dd className="text-right">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Payment</p>
                {detailQuery.isLoading ? (
                  <Skeleton className="h-8 w-full" />
                ) : detailQuery.data?.paymentLink ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-border p-2">
                    <div>
                      <p className="text-sm">
                        {formatCentsUSD(detailQuery.data.paymentLink.amountCents)} —{" "}
                        {detailQuery.data.paymentLink.purpose}
                      </p>
                      <Badge
                        variant={
                          PAYMENT_STATUS_VARIANT[detailQuery.data.paymentLink.status] ?? "outline"
                        }
                      >
                        {detailQuery.data.paymentLink.status}
                      </Badge>
                    </div>
                    {detailQuery.data.paymentLink.status !== "paid" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resendingLink}
                        onClick={resendPaymentLink}
                      >
                        Resend link
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No payment requested for this booking.
                  </p>
                )}
              </div>

              {!ACTIONABLE_STATUSES.has(active.status) ? (
                <p className="text-sm text-muted-foreground">
                  This booking is {active.status.replace(/_/g, " ")} — it can no longer be
                  confirmed, rescheduled or cancelled.
                </p>
              ) : !rescheduling ? (
                <div className="flex flex-col gap-2">
                  {active.status === "scheduled" && (
                    <Button onClick={() => runAction("confirm")}>Confirm</Button>
                  )}
                  <Button variant="outline" onClick={() => setRescheduling(true)}>
                    Reschedule
                  </Button>
                  <Button variant="outline" onClick={() => runAction("cancel")}>
                    Cancel booking
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Pick a new time — only slots this resource can actually hold are shown.
                  </p>
                  <DataState
                    query={slotsQuery}
                    empty={{ title: "No open slots in the next few weeks" }}
                    render={(slots) => (
                      <div className="max-h-72 space-y-3 overflow-y-auto">
                        {groupSlotsByDay(slots).map((group) => (
                          <div key={group.day}>
                            <p className="mb-1 text-xs font-medium text-muted-foreground">
                              {group.day}
                            </p>
                            {/* One column on phones, two from sm up; labels wrap instead of clipping. */}
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {group.slots.map((slot) => (
                                <Button
                                  key={slot.id}
                                  size="sm"
                                  variant="outline"
                                  className="h-auto whitespace-normal py-2"
                                  onClick={() => pickSlot(slot.id)}
                                >
                                  {new Date(slot.start).toLocaleTimeString(undefined, {
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}
                                </Button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  />
                  <Button variant="ghost" size="sm" onClick={() => setRescheduling(false)}>
                    Back
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
