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
  ToggleGroup,
  ToggleGroupItem,
} from "@heyloo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { tenantQueryKey, useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";
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
  const [view, setView] = useState<BookingCalendarView>("list");
  const [selected, setSelected] = useState<BookingCalendarEntry | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [resendingLink, setResendingLink] = useState(false);

  const query = useTenantQuery(
    tenantId ?? "",
    "bookings",
    [],
    async (): Promise<BookingCalendarEntry[]> => {
      // Two flat queries rather than an embedded `customers(name)` select —
      // the hand-maintained Database type has no `Relationships` metadata
      // (packages/supabase-client/src/database.types.ts), so FK-embedded
      // selects don't type-check against it.
      const { data: bookings } = await supabaseBrowserClient
        .from("bookings")
        .select("id, start_at, status, customer_id")
        .eq("tenant_id", tenantId as string)
        .order("start_at", { ascending: true })
        .limit(200);

      const customerIds = [
        ...new Set((bookings ?? []).map((b) => b.customer_id).filter((id): id is string => !!id)),
      ];
      const { data: customers } = customerIds.length
        ? await supabaseBrowserClient.from("customers").select("id, name").in("id", customerIds)
        : { data: [] as { id: string; name: string | null }[] };
      const nameById = new Map((customers ?? []).map((c) => [c.id, c.name]));

      return (bookings ?? []).map((b) => ({
        id: b.id,
        startAt: b.start_at,
        status: b.status,
        customerName: (b.customer_id && nameById.get(b.customer_id)) ?? null,
      }));
    },
    { enabled: !!tenantId },
  );

  const detailQuery = useTenantQuery(
    tenantId ?? "",
    "booking_detail",
    [selected?.id ?? ""],
    async (): Promise<BookingDetail> => {
      const bookingId = selected?.id as string;
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
    { enabled: !!selected && !!tenantId },
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
        .order("slot_range", { ascending: true })
        .limit(30);
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
  }

  async function runAction(action: "confirm" | "cancel") {
    if (!selected) return;
    const res = await fetch(`/api/tenant/bookings/${selected.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = (await res.json()) as { ok?: boolean; sms_queued?: boolean; error?: string };
    if (!res.ok || !body.ok) {
      toast.error("Something went wrong — please try again.");
      return;
    }
    toast.success(
      body.sms_queued ? "Customer notified by SMS" : "Saved — SMS notification pending",
    );
    closeSheet();
    if (tenantId)
      void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "bookings"] });
  }

  async function pickSlot(slotId: string) {
    if (!selected || !tenantId) return;
    const res = await fetch(`/api/tenant/bookings/${selected.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reschedule", new_slot_id: slotId }),
    });
    if (res.status === 409) {
      toast.error("That slot was just taken — pick another.");
      void queryClient.invalidateQueries({
        queryKey: tenantQueryKey(tenantId, "reschedule_slots", detailQuery.data?.resourceId ?? ""),
      });
      return;
    }
    const body = (await res.json()) as { ok?: boolean; sms_queued?: boolean; error?: string };
    if (!res.ok || !body.ok) {
      toast.error("Something went wrong — please try again.");
      return;
    }
    toast.success(
      body.sms_queued ? "Customer notified by SMS" : "Saved — SMS notification pending",
    );
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
    toast.success("Payment link re-sent by SMS");
    void queryClient.invalidateQueries({
      queryKey: tenantQueryKey(tenantId, "booking_detail", selected?.id ?? ""),
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
        }
      />

      <DataState
        query={query}
        empty={{ title: "No bookings yet", description: "Confirmed bookings will show up here." }}
        render={(bookings) => (
          <BookingCalendar
            bookings={bookings}
            view={view}
            onViewChange={setView}
            onSelect={setSelected}
          />
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

      <Sheet open={!!selected} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{selected?.customerName ?? "Booking"}</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="mt-4 space-y-4">
              <StatusBadge variant="booking" value={selected.status} />
              <p className="text-sm text-muted-foreground">
                {new Date(selected.startAt).toLocaleString()}
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
                structuredPayloadEntries(detailQuery.data.structuredPayload).length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Captured on the call
                    </p>
                    <dl className="space-y-1 rounded-md border border-border p-2 text-sm">
                      {structuredPayloadEntries(detailQuery.data.structuredPayload).map(
                        ([label, value]) => (
                          <div key={label} className="flex justify-between gap-2">
                            <dt className="capitalize text-muted-foreground">{label}</dt>
                            <dd className="text-right">{value}</dd>
                          </div>
                        ),
                      )}
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

              {!rescheduling ? (
                <div className="flex flex-col gap-2">
                  <Button onClick={() => runAction("confirm")}>Confirm</Button>
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
                      <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto">
                        {slots.map((slot) => (
                          <Button
                            key={slot.id}
                            size="sm"
                            variant="outline"
                            onClick={() => pickSlot(slot.id)}
                          >
                            {new Date(slot.start).toLocaleString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </Button>
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
