"use client";

import { customerNoteSchema } from "@heyloo/canonical-types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  type CustomerSegment,
  formatPhoneDisplay,
  PageHeader,
  SegmentBadge,
  StatusBadge,
  Textarea,
} from "@heyloo/ui";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

export interface CustomerDetailData {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  segment: CustomerSegment;
  lifetimeValueCents: number;
  metadata: Record<string, unknown>;
  consent: { sms?: boolean; call?: boolean; captured_at?: string } | null;
  calls: { id: string; startedAt: string | null; classification: string | null }[];
  bookings: { id: string; startAt: string; status: string }[];
}

/** `customers.metadata` — vertical-specific: `vehicles`/`pets` arrays are
 * the two shapes the schema comment names (`20260907130400_customers.sql`);
 * rendered as a labeled list per entry, falling back to a generic
 * key/value dump for anything else so this never hides data it doesn't
 * recognize. */
function renderMetadataList(entries: Record<string, unknown>[]): string {
  return entries
    .map((entry) =>
      Object.entries(entry)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
        .join(", "),
    )
    .filter((s) => s.length > 0)
    .join(" · ");
}

export function CustomerDetailClient({ customer }: { customer: CustomerDetailData }) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitNote() {
    const parsed = customerNoteSchema.safeParse({ customer_id: customer.id, note });
    if (!parsed.success) {
      toast.error("Note cannot be empty.");
      return;
    }
    setSubmitting(true);
    const res = await fetch(`/api/tenant/customers/${customer.id}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note }),
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success("Note saved");
      setNote("");
    } else {
      toast.error("Couldn't save the note — please try again.");
    }
  }

  const hasHistory = customer.calls.length > 0 || customer.bookings.length > 0;
  const vehicles = Array.isArray(customer.metadata["vehicles"])
    ? (customer.metadata["vehicles"] as Record<string, unknown>[])
    : [];
  const pets = Array.isArray(customer.metadata["pets"])
    ? (customer.metadata["pets"] as Record<string, unknown>[])
    : [];
  const hasConsent = !!(customer.consent?.sms || customer.consent?.call);

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.name ?? "Unknown customer"}
        description={
          <span className="flex items-center gap-2">
            {formatPhoneDisplay(customer.phone)}
            <Link
              href={`/dashboard/messages/${encodeURIComponent(customer.phone)}`}
              // text-primary-hover, not text-primary: the base accent-500
              // measures 3.42:1 for this normal-weight link text, below
              // WCAG AA's 4.5:1 (axe color-contrast, round-final tenant
              // review). accent-600 clears AA in both themes.
              className="text-primary-hover underline underline-offset-2"
            >
              Message this customer
            </Link>
          </span>
        }
        actions={
          <>
            {hasConsent ? (
              <Badge variant="success">Consent on file</Badge>
            ) : (
              <Badge variant="outline">No consent on file</Badge>
            )}
            <SegmentBadge segment={customer.segment} />
          </>
        }
      />

      {(vehicles.length > 0 || pets.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {vehicles.length > 0 ? "Vehicles" : "Pets"} on file
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {vehicles.length > 0 && <p>{renderMetadataList(vehicles)}</p>}
            {pets.length > 0 && <p>{renderMetadataList(pets)}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent>
          {!hasHistory ? (
            <p className="text-sm text-muted-foreground">First-time caller — no history yet.</p>
          ) : (
            <div className="space-y-2">
              {customer.calls.map((call) => (
                <div key={call.id} className="flex items-center justify-between text-sm">
                  <span>
                    {call.startedAt ? new Date(call.startedAt).toLocaleString() : "In progress"}
                  </span>
                  {call.classification && (
                    <StatusBadge variant="call-class" value={call.classification} />
                  )}
                </div>
              ))}
              {customer.bookings.map((booking) => (
                <div key={booking.id} className="flex items-center justify-between text-sm">
                  <span>{new Date(booking.startAt).toLocaleString()}</span>
                  <StatusBadge variant="booking" value={booking.status} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Log a note</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note about this customer…"
          />
          <Button size="sm" onClick={submitNote} disabled={submitting}>
            Save note
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
