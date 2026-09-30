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
import { useRouter } from "@/i18n/navigation";

export interface CustomerDetailData {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  segment: CustomerSegment;
  lifetimeValueCents: number;
  metadata: Record<string, unknown>;
  consent: { sms?: boolean; call?: boolean; captured_at?: string } | null;
  /** `customers.sms_opt_out` (STOP): overrides any consent on file (QA-1 F-09). */
  smsOptOut?: boolean;
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

export interface CustomerNote {
  body: string;
  createdAt: string | null;
  authorId: string | null;
}

/**
 * `customers.metadata.notes` -> newest-first list. The notes route appends
 * `{ body, created_at, author_id }`; tolerate plain strings / `{ note | text }`
 * entries so older or hand-imported data is shown rather than hidden (QA-1 F-05).
 */
export function parseCustomerNotes(metadata: Record<string, unknown>): CustomerNote[] {
  const raw = metadata["notes"];
  const list: unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const notes: CustomerNote[] = [];
  for (const entry of list) {
    if (typeof entry === "string") {
      if (entry.trim()) notes.push({ body: entry, createdAt: null, authorId: null });
      continue;
    }
    if (entry && typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      const body = [e["body"], e["note"], e["text"]].find((v) => typeof v === "string") as
        | string
        | undefined;
      if (!body?.trim()) continue;
      notes.push({
        body,
        createdAt: typeof e["created_at"] === "string" ? e["created_at"] : null,
        authorId: typeof e["author_id"] === "string" ? e["author_id"] : null,
      });
    }
  }
  // Stored oldest-first (append order); undated legacy entries sort as oldest.
  return notes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => {
      const ta = a.n.createdAt ?? "";
      const tb = b.n.createdAt ?? "";
      return ta === tb ? b.i - a.i : ta < tb ? 1 : -1;
    })
    .map(({ n }) => n);
}

export function CustomerDetailClient({
  customer,
  currentUserId,
}: {
  customer: CustomerDetailData;
  currentUserId?: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const notes = parseCustomerNotes(customer.metadata);

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
      // Re-run the server component so the new note appears in the list.
      router.refresh();
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
  const optedOut = customer.smsOptOut === true;

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.name ?? "Unknown customer"}
        description={
          <span className="flex items-center gap-2">
            {formatPhoneDisplay(customer.phone)}
            {optedOut ? (
              <span className="text-muted-foreground">Opted out of texts — messaging disabled</span>
            ) : (
              <Link
                href={`/dashboard/messages/${encodeURIComponent(customer.phone)}`}
                // text-accent-text, not text-primary: the base accent-500
                // measures 3.42:1 for this normal-weight link text, below
                // WCAG AA's 4.5:1 (axe color-contrast, round-final tenant
                // review). The dedicated accent-text token (accent-600)
                // clears AA in both themes (DESIGN-4).
                className="text-accent-text underline underline-offset-2"
              >
                Message this customer
              </Link>
            )}
          </span>
        }
        actions={
          <>
            {optedOut ? (
              <Badge variant="destructive">Opted out</Badge>
            ) : hasConsent ? (
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
          <CardTitle className="text-base">Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            <ul className="space-y-2" aria-label="Customer notes">
              {notes.map((n, i) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: read-only list, notes have no id
                  key={`${n.createdAt ?? "legacy"}-${i}`}
                  className="rounded-md border border-border p-2 text-sm"
                >
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {n.createdAt ? new Date(n.createdAt).toLocaleString() : "Earlier"}
                    {" · "}
                    {n.authorId && n.authorId === currentUserId ? "You" : "Team member"}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm font-medium">Log a note</p>
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
