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
  Badge,
  Button,
  DataState,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { type SaveResult, saveErrorMessage, sendJson } from "@/lib/settings/client";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

const RESOURCE_TYPES = ["chair", "room", "table", "bay", "staff", "agent"] as const;

interface ResourceRow {
  id: string;
  type: (typeof RESOURCE_TYPES)[number];
  name: string;
  capacity: number;
  active: boolean;
  room_type: string | null;
  metadata: Record<string, unknown> | null;
  buffer_minutes: number | null;
}

/**
 * SETTINGS-1: appointment length (`resources.metadata.slot_minutes`) and
 * buffer (`resources.buffer_minutes`) — both read by
 * `fn_regenerate_availability_slots` but never exposed. The API now
 * rebuilds this resource's bookable times as soon as either changes.
 */
const SLOT_OPTIONS = [
  { value: "default", label: "Default (30 min; full night for rooms at a motel)" },
  { value: "15", label: "15 minutes" },
  { value: "20", label: "20 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "45", label: "45 minutes" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1½ hours" },
  { value: "120", label: "2 hours" },
  { value: "180", label: "3 hours" },
  { value: "240", label: "4 hours" },
  { value: "480", label: "8 hours" },
  { value: "1440", label: "Whole day / night" },
] as const;

const BUFFER_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120] as const;

function slotLabel(resource: ResourceRow): string {
  const minutes = resource.metadata?.["slot_minutes"];
  if (typeof minutes !== "number") return "Default";
  return SLOT_OPTIONS.find((o) => o.value === String(minutes))?.label ?? `${minutes} min`;
}

/**
 * SETTINGS-1 review: say WHY a save/removal failed. A removal whose future
 * times couldn't be taken off sale now changes nothing (the route 502s
 * `slots_not_cleared`), so the resource stays listed and can be retried.
 */
function resourceErrorMessage(
  result: Pick<SaveResult, "status" | "error">,
  action: "save" | "remove" = "save",
): string {
  if (result.error === "slots_not_cleared") {
    return "Couldn't remove it — its bookable times couldn't be cleared. Nothing changed; please try again.";
  }
  if (result.error === "owner_or_admin_required") return saveErrorMessage(result);
  return action === "remove" ? "Couldn't remove — please try again." : saveErrorMessage(result);
}

const resourceFormSchema = z.object({
  type: z.enum(RESOURCE_TYPES),
  name: z.string().trim().min(1, "Name is required").max(200),
  capacity: z.number().int().positive("Must be at least 1").max(10_000),
  room_type: z.string().trim().max(100).optional(),
  slot_minutes: z.string(),
  buffer_minutes: z.number().int().min(0).max(240),
});

type ResourceFormValues = z.infer<typeof resourceFormSchema>;

export default function ResourcesSetupPage() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ResourceRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ResourceRow | null>(null);
  const [saving, setSaving] = useState(false);

  const query = useTenantQuery(
    tenantId ?? "",
    "resources",
    [],
    async (): Promise<ResourceRow[]> => {
      // `room_type` is a real column not yet on the hand-maintained
      // `ResourceRow` type in @heyloo/supabase-client (docs/audit/
      // FIX_REQUESTS.md) — cast immediately after the query.
      const { data } = await supabaseBrowserClient
        .from("resources")
        .select("id, type, name, capacity, active, room_type, metadata, buffer_minutes")
        .eq("tenant_id", tenantId as string)
        .eq("active", true)
        .order("type", { ascending: true })
        .order("name", { ascending: true });
      return (data ?? []) as unknown as ResourceRow[];
    },
    { enabled: !!tenantId },
  );

  const form = useForm<ResourceFormValues>({
    resolver: zodResolver(resourceFormSchema),
    defaultValues: {
      type: "room",
      name: "",
      capacity: 1,
      room_type: "",
      slot_minutes: "default",
      buffer_minutes: 0,
    },
  });

  useEffect(() => {
    if (dialogOpen) {
      form.reset(
        editing
          ? {
              type: editing.type,
              name: editing.name,
              capacity: editing.capacity,
              room_type: editing.room_type ?? "",
              slot_minutes:
                typeof editing.metadata?.["slot_minutes"] === "number"
                  ? String(editing.metadata["slot_minutes"])
                  : "default",
              buffer_minutes: editing.buffer_minutes ?? 0,
            }
          : {
              type: "room",
              name: "",
              capacity: 1,
              room_type: "",
              slot_minutes: "default",
              buffer_minutes: 0,
            },
      );
    }
  }, [dialogOpen, editing, form]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(resource: ResourceRow) {
    setEditing(resource);
    setDialogOpen(true);
  }

  async function submit(values: ResourceFormValues) {
    setSaving(true);
    const payload = {
      ...values,
      room_type: values.room_type ? values.room_type : null,
      slot_minutes: values.slot_minutes === "default" ? null : Number(values.slot_minutes),
    };
    const result = await sendJson<{ slots_updated?: boolean }>(
      editing ? `/api/tenant/resources/${editing.id}` : "/api/tenant/resources",
      payload,
      editing ? "PATCH" : "POST",
    );
    setSaving(false);
    if (!result.ok) {
      toast.error(resourceErrorMessage(result));
      return;
    }
    toast.success(
      result.body?.slots_updated === false
        ? "Saved — bookable times finish updating overnight."
        : "Saved — bookable times are updated.",
    );
    setDialogOpen(false);
    if (tenantId)
      void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "resources"] });
  }

  async function confirmDelete() {
    if (!pendingDelete || !tenantId) return;
    const result = await sendJson(`/api/tenant/resources/${pendingDelete.id}`, undefined, "DELETE");
    if (!result.ok) {
      toast.error(resourceErrorMessage(result, "remove"));
      return;
    }
    toast.success("Removed — your AI stops offering its times now.");
    setPendingDelete(null);
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "resources"] });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Resources"
        description="The rooms, chairs, bays, tables, or staff lines your AI checks availability against and books onto."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 size-4" /> Add resource
          </Button>
        }
      />

      <DataState
        query={query}
        empty={{
          title: "No resources yet",
          description: "Add at least one resource so your AI has something to book.",
          action: { label: "Add resource", onClick: openCreate },
        }}
        render={(resources) => (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Room type</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Appointment length</TableHead>
                  <TableHead>Buffer</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resources.map((resource) => (
                  <TableRow key={resource.id}>
                    <TableCell className="font-medium">{resource.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {resource.type}
                      </Badge>
                    </TableCell>
                    <TableCell>{resource.room_type ?? "—"}</TableCell>
                    <TableCell>{resource.capacity}</TableCell>
                    <TableCell>{slotLabel(resource)}</TableCell>
                    <TableCell>
                      {resource.buffer_minutes ? `${resource.buffer_minutes} min` : "None"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(resource)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setPendingDelete(resource)}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit resource" : "Add resource"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Room 12, Chair 2, Bay A" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {RESOURCE_TYPES.map((t) => (
                          <SelectItem key={t} value={t} className="capitalize">
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="room_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Room/sub-type (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Queen, King, Suite" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="capacity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Capacity</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        value={field.value}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="slot_minutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Appointment length</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SLOT_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Each bookable time is this long.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="buffer_minutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Buffer between bookings</FormLabel>
                      <Select
                        value={String(field.value)}
                        onValueChange={(v) => field.onChange(Number(v))}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {BUFFER_OPTIONS.map((minutes) => (
                            <SelectItem key={minutes} value={String(minutes)}>
                              {minutes === 0 ? "None" : `${minutes} minutes`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Kept free after each booking.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={saving}>
                  Save
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deactivates the resource — your AI stops booking new appointments onto it, but
              existing bookings are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
