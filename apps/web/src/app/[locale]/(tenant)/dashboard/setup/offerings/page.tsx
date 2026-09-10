"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
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
  CentsInput,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Link } from "@/i18n/navigation";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

interface OfferingRow {
  id: string;
  name: string;
  category: string | null;
  duration_minutes: number | null;
  price_cents: number | null;
  resource_type_required: string | null;
  metadata: { modifiers?: { name: string; price_cents?: number }[]; allergens?: string[] };
  active: boolean;
}

const offeringFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  category: z.string().trim().max(200).optional(),
  duration_minutes: z.number().int().positive().optional(),
  price_cents: z.number().int().min(0).optional(),
  modifiers: z.array(
    z.object({
      name: z.string().trim().min(1, "Modifier name is required"),
      price_cents: z.number().int().min(0).optional(),
    }),
  ),
  allergens: z.string(),
});

type OfferingFormValues = z.infer<typeof offeringFormSchema>;

function allergensToLine(allergens: string[] | undefined): string {
  return (allergens ?? []).join(", ");
}

function lineToAllergens(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export default function OfferingsSetupPage() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OfferingRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<OfferingRow | null>(null);
  const [saving, setSaving] = useState(false);

  const query = useTenantQuery(
    tenantId ?? "",
    "offerings",
    [],
    async (): Promise<OfferingRow[]> => {
      const { data } = await supabaseBrowserClient
        .from("offerings")
        .select(
          "id, name, category, duration_minutes, price_cents, resource_type_required, metadata, active",
        )
        .eq("tenant_id", tenantId as string)
        .eq("active", true)
        .order("category", { ascending: true, nullsFirst: false })
        .order("name", { ascending: true });
      return (data ?? []) as unknown as OfferingRow[];
    },
    { enabled: !!tenantId },
  );

  const form = useForm<OfferingFormValues>({
    resolver: zodResolver(offeringFormSchema),
    defaultValues: { name: "", modifiers: [], allergens: "" },
  });
  const modifierFields = useFieldArray({ control: form.control, name: "modifiers" });

  useEffect(() => {
    if (dialogOpen) {
      form.reset(
        editing
          ? {
              name: editing.name,
              category: editing.category ?? "",
              duration_minutes: editing.duration_minutes ?? undefined,
              price_cents: editing.price_cents ?? undefined,
              modifiers: editing.metadata.modifiers ?? [],
              allergens: allergensToLine(editing.metadata.allergens),
            }
          : { name: "", category: "", modifiers: [], allergens: "" },
      );
    }
  }, [dialogOpen, editing, form]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(offering: OfferingRow) {
    setEditing(offering);
    setDialogOpen(true);
  }

  async function submit(values: OfferingFormValues) {
    setSaving(true);
    const payload = {
      name: values.name,
      category: values.category ? values.category : null,
      duration_minutes: values.duration_minutes,
      price_cents: values.price_cents,
      metadata: {
        modifiers: values.modifiers.filter((m) => m.name.trim().length > 0),
        allergens: lineToAllergens(values.allergens),
      },
    };
    const res = await fetch(
      editing ? `/api/tenant/offerings/${editing.id}` : "/api/tenant/offerings",
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
      void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "offerings"] });
  }

  async function confirmDelete() {
    if (!pendingDelete || !tenantId) return;
    const res = await fetch(`/api/tenant/offerings/${pendingDelete.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't remove — please try again.");
      return;
    }
    toast.success("Removed");
    setPendingDelete(null);
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "offerings"] });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Offerings & menu"
        description="Services, room types, or menu items — with prices, modifiers, and allergens — that your AI can quote, book, or take orders against."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/setup/offerings/import">Import menu</Link>
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-1 size-4" /> Add offering
            </Button>
          </>
        }
      />

      <DataState
        query={query}
        empty={{
          title: "No offerings yet",
          description: "Add at least one so your AI can quote a price or take an order.",
          action: { label: "Add offering", onClick: openCreate },
        }}
        render={(offerings) => (
          <>
            {/* Card layout below `lg` — the Name/Category/Price/Duration/Allergens
                columns don't fit a raw table at phone or tablet widths
                (matches the DataTable card breakpoint used elsewhere). */}
            <div className="flex flex-col gap-2 lg:hidden">
              {offerings.map((offering) => (
                <div key={offering.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{offering.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {offering.category ?? "No category"}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm tabular-nums">
                      {offering.price_cents != null ? formatCentsUSD(offering.price_cents) : "—"}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {offering.duration_minutes && (
                      <Badge variant="outline">{offering.duration_minutes}m</Badge>
                    )}
                    {(offering.metadata.allergens ?? []).map((a) => (
                      <Badge key={a} variant="destructive">
                        {a}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-2 flex justify-end gap-1 border-t border-border pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(offering)}
                      aria-label={`Edit ${offering.name}`}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setPendingDelete(offering)}
                      aria-label={`Remove ${offering.name}`}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto rounded-md border border-border lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Allergens</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {offerings.map((offering) => (
                    <TableRow key={offering.id}>
                      <TableCell className="font-medium">{offering.name}</TableCell>
                      <TableCell>{offering.category ?? "—"}</TableCell>
                      <TableCell>
                        {offering.price_cents != null ? formatCentsUSD(offering.price_cents) : "—"}
                      </TableCell>
                      <TableCell>
                        {offering.duration_minutes ? `${offering.duration_minutes}m` : "—"}
                      </TableCell>
                      <TableCell>
                        {(offering.metadata.allergens ?? []).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {(offering.metadata.allergens ?? []).map((a) => (
                              <Badge key={a} variant="destructive">
                                {a}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(offering)}
                          aria-label={`Edit ${offering.name}`}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setPendingDelete(offering)}
                          aria-label={`Remove ${offering.name}`}
                        >
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit offering" : "Add offering"}</DialogTitle>
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
                      <Input
                        placeholder="e.g. Oil change, Margherita pizza, King room"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category (optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Appetizers, Cleanings" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="price_cents"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Price</FormLabel>
                      <FormControl>
                        <CentsInput value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="duration_minutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration in minutes (optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <FormLabel>Modifiers</FormLabel>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => modifierFields.append({ name: "", price_cents: undefined })}
                  >
                    <Plus className="mr-1 size-3.5" /> Add modifier
                  </Button>
                </div>
                <div className="space-y-2">
                  {modifierFields.fields.map((field, index) => (
                    <div key={field.id} className="flex items-center gap-2">
                      <FormField
                        control={form.control}
                        name={`modifiers.${index}.name`}
                        render={({ field: nameField }) => (
                          <FormItem className="flex-1">
                            <FormControl>
                              <Input placeholder="e.g. Extra cheese" {...nameField} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`modifiers.${index}.price_cents`}
                        render={({ field: priceField }) => (
                          <FormItem className="w-28">
                            <FormControl>
                              <CentsInput value={priceField.value} onChange={priceField.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => modifierFields.remove(index)}
                        aria-label="Remove modifier"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  {modifierFields.fields.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No modifiers — add one if this item has options (size, add-ons, etc.).
                    </p>
                  )}
                </div>
              </div>

              <FormField
                control={form.control}
                name="allergens"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Allergens (comma-separated, optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. peanuts, dairy, gluten" {...field} />
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
              This deactivates the offering — your AI stops quoting or booking it, but past
              bookings/orders that reference it are kept.
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
