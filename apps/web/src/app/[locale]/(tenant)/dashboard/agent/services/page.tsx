"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
import { Link } from "@/i18n/navigation";
import { SAVED_NEXT_CALL, saveErrorMessage, sendJson } from "@/lib/settings/client";
import { serviceDialogSchema } from "@/lib/settings/schemas";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

type FieldErrors = Partial<Record<"name" | "duration_minutes" | "price_cents", string>>;

/**
 * Agent → Services. SETTINGS-1: writes now go through the same
 * server-validated routes as Setup → Offerings (`POST /api/tenant/
 * offerings`, `PATCH|DELETE /api/tenant/offerings/[id]`) instead of a
 * direct browser insert with client-only checks; the dialog shows field
 * errors inline; removing a service asks first and reports failures.
 * Services are read by the AI live on every call (`list_offerings`).
 */
export default function ServicesTabPage() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OfferingRowData | null>(null);
  const [removing, setRemoving] = useState<OfferingRowData | null>(null);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("");
  const [priceCents, setPriceCents] = useState<number | undefined>(undefined);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

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

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "offerings"] });
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "settings_checklist"] });
  }

  function openDialog(offering?: OfferingRowData) {
    setEditing(offering ?? null);
    setName(offering?.name ?? "");
    setDuration(offering?.durationMinutes ? String(offering.durationMinutes) : "");
    setPriceCents(offering?.priceCents ?? undefined);
    setErrors({});
    setDialogOpen(true);
  }

  async function save() {
    const parsed = serviceDialogSchema.safeParse({
      name,
      duration_minutes: duration.trim() === "" ? undefined : Number(duration),
      price_cents: priceCents,
    });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FieldErrors;
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSaving(true);
    // A new service simply omits an empty length/price. An EDIT sends `null`
    // so emptying the field really removes the stored value (SETTINGS-1
    // review: it used to be dropped from the PATCH and the old price stayed live).
    const payload = editing
      ? {
          name: parsed.data.name,
          duration_minutes: parsed.data.duration_minutes ?? null,
          price_cents: parsed.data.price_cents ?? null,
        }
      : {
          name: parsed.data.name,
          ...(parsed.data.duration_minutes !== undefined
            ? { duration_minutes: parsed.data.duration_minutes }
            : {}),
          ...(parsed.data.price_cents !== undefined
            ? { price_cents: parsed.data.price_cents }
            : {}),
        };
    const result = editing
      ? await sendJson(`/api/tenant/offerings/${editing.id}`, payload, "PATCH")
      : await sendJson("/api/tenant/offerings", payload);
    setSaving(false);
    if (!result.ok) {
      toast.error(saveErrorMessage(result));
      return;
    }
    toast.success(SAVED_NEXT_CALL);
    setDialogOpen(false);
    refresh();
  }

  async function confirmRemove() {
    const offering = removing;
    setRemoving(null);
    if (!offering) return;
    const result = await sendJson(`/api/tenant/offerings/${offering.id}`, undefined, "DELETE");
    if (!result.ok) {
      toast.error(saveErrorMessage(result));
      return;
    }
    toast.success(`Removed “${offering.name}” — your AI stops offering it from the next call.`);
    refresh();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Your AI offers these on every call. For categories, modifiers, and allergens, use{" "}
        <Link href="/dashboard/setup/offerings" className="underline">
          Setup → Offerings
        </Link>
        .
      </p>
      <ServiceOfferingEditor
        offerings={query.data ?? []}
        onChange={(action, offering) => {
          if (action === "add") openDialog();
          else if (action === "edit" && offering) openDialog(offering);
          else if (action === "delete" && offering) setRemoving(offering);
        }}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit service" : "Add service"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="service-name">Name</Label>
              <Input
                id="service-name"
                value={name}
                aria-invalid={!!errors.name}
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="service-duration">Length (minutes)</Label>
              <Input
                id="service-duration"
                type="number"
                inputMode="numeric"
                min={5}
                max={1440}
                step={5}
                value={duration}
                aria-invalid={!!errors.duration_minutes}
                onChange={(e) => setDuration(e.target.value)}
              />
              {errors.duration_minutes && (
                <p className="text-xs text-destructive">{errors.duration_minutes}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="service-price">Price</Label>
              <CentsInput id="service-price" value={priceCents} onChange={setPriceCents} />
              {errors.price_cents && (
                <p className="text-xs text-destructive">{errors.price_cents}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{removing?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Your AI stops offering it on calls. Past bookings and orders keep it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmRemove()}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
