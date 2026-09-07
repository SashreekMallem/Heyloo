"use client";

import { customerNoteSchema } from "@heyloo/canonical-types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  type CustomerSegment,
  SegmentBadge,
  StatusBadge,
  Textarea,
} from "@heyloo/ui";
import { useState } from "react";
import { toast } from "sonner";

export interface CustomerDetailData {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  segment: CustomerSegment;
  lifetimeValueCents: number;
  calls: { id: string; startedAt: string | null; classification: string | null }[];
  bookings: { id: string; startAt: string; status: string }[];
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{customer.name ?? "Unknown customer"}</h1>
          <p className="text-sm text-muted-foreground">{customer.phone}</p>
        </div>
        <SegmentBadge segment={customer.segment} />
      </div>

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
