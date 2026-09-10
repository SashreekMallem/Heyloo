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
}

const resourceFormSchema = z.object({
  type: z.enum(RESOURCE_TYPES),
  name: z.string().trim().min(1, "Name is required").max(200),
  capacity: z.number().int().positive("Must be at least 1").max(10_000),
  room_type: z.string().trim().max(100).optional(),
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
        .select("id, type, name, capacity, active, room_type")
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
    defaultValues: { type: "room", name: "", capacity: 1, room_type: "" },
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
            }
          : { type: "room", name: "", capacity: 1, room_type: "" },
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
    const payload = { ...values, room_type: values.room_type ? values.room_type : null };
    const res = await fetch(
      editing ? `/api/tenant/resources/${editing.id}` : "/api/tenant/resources",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    setSaving(false);
    if (!res.ok) {
      toast.error("Couldn't save — please try again.");
      return;
    }
    toast.success("Saved");
    setDialogOpen(false);
    if (tenantId)
      void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "resources"] });
  }

  async function confirmDelete() {
    if (!pendingDelete || !tenantId) return;
    const res = await fetch(`/api/tenant/resources/${pendingDelete.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't remove — please try again.");
      return;
    }
    toast.success("Removed");
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
