"use client";

import {
  BookingCalendar,
  type BookingCalendarEntry,
  type BookingCalendarView,
  Button,
  DataState,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  StatusBadge,
} from "@heyloo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

export default function BookingsPage() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();
  const [view, setView] = useState<BookingCalendarView>("list");
  const [selected, setSelected] = useState<BookingCalendarEntry | null>(null);

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

  async function runAction(action: "confirm" | "reschedule" | "cancel") {
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
    setSelected(null);
    if (tenantId)
      void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "bookings"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Bookings</h1>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={view === "list" ? "default" : "outline"}
            onClick={() => setView("list")}
          >
            List
          </Button>
          <Button
            size="sm"
            variant={view === "calendar" ? "default" : "outline"}
            onClick={() => setView("calendar")}
          >
            Calendar
          </Button>
        </div>
      </div>

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

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
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
              <div className="flex flex-col gap-2">
                <Button onClick={() => runAction("confirm")}>Confirm</Button>
                <Button variant="outline" onClick={() => runAction("cancel")}>
                  Cancel booking
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
