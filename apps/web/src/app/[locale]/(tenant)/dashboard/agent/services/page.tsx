"use client";

import { offeringSchema } from "@heyloo/canonical-types";
import {
  Button,
  CentsInput,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  type OfferingRowData,
  ServiceOfferingEditor,
} from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

export default function ServicesTabPage() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OfferingRowData | null>(null);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [priceCents, setPriceCents] = useState<number | undefined>(undefined);

  const query = useQuery({
    queryKey: ["tenant", tenantId, "offerings"],
    queryFn: async (): Promise<OfferingRowData[]> => {
      const { data } = await supabaseBrowserClient
        .from("offerings")
        .select("id, name, duration_minutes, price_cents, active")
        .eq("tenant_id", tenantId as string)
        .order("created_at", { ascending: true });
      return (data ?? []).map((o) => ({
        id: o.id,
        name: o.name,
        durationMinutes: o.duration_minutes,
        priceCents: o.price_cents,
        active: o.active,
      }));
    },
    enabled: !!tenantId,
  });

  function openDialog(offering?: OfferingRowData) {
    setEditing(offering ?? null);
    setName(offering?.name ?? "");
    setDuration(offering?.durationMinutes ?? undefined);
    setPriceCents(offering?.priceCents ?? undefined);
    setDialogOpen(true);
  }

  async function save() {
    const parsed = offeringSchema.safeParse({
      name,
      duration_minutes: duration,
      price_cents: priceCents,
    });
    if (!parsed.success) {
      toast.error("Enter at least a service name.");
      return;
    }
    const payload = {
      name: parsed.data.name,
      duration_minutes: duration ?? null,
      price_cents: priceCents ?? null,
    };
    const result = editing
      ? await supabaseBrowserClient.from("offerings").update(payload).eq("id", editing.id)
      : await supabaseBrowserClient
          .from("offerings")
          .insert({ ...payload, tenant_id: tenantId as string });

    if (result.error) {
      toast.error("Couldn't save — please try again.");
      return;
    }
    toast.success("Saved");
    setDialogOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "offerings"] });
  }

  async function remove(offering: OfferingRowData) {
    await supabaseBrowserClient.from("offerings").update({ active: false }).eq("id", offering.id);
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "offerings"] });
  }

  return (
    <div>
      <ServiceOfferingEditor
        offerings={query.data ?? []}
        onChange={(action, offering) => {
          if (action === "add") openDialog();
          else if (action === "edit" && offering) openDialog(offering);
          else if (action === "delete" && offering) void remove(offering);
        }}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit service" : "Add service"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Duration (minutes)</Label>
              <Input
                type="number"
                value={duration ?? ""}
                onChange={(e) => setDuration(e.target.value ? Number(e.target.value) : undefined)}
              />
            </div>
            <div className="space-y-1">
              <Label>Price</Label>
              <CentsInput value={priceCents} onChange={setPriceCents} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
