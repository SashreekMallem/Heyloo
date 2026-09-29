"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  PhoneInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { NotLiveBadge, NotLiveNote } from "@/components/tenant/settings/not-live-note";
import { applyIssues, SAVED_NEXT_CALL, saveErrorMessage, sendJson } from "@/lib/settings/client";
import {
  type InstructionsFormValues,
  instructionsFormSchema,
  TRANSFER_WINDOWS,
} from "@/lib/settings/schemas";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

interface InstructionsRow {
  special_instructions: string | null;
  transfer_number: string | null;
  dynamic_variable_overrides: unknown;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formValuesFrom(row: InstructionsRow): InstructionsFormValues {
  const overrides = (row.dynamic_variable_overrides ?? {}) as Record<string, unknown>;
  const routing = (overrides["call_routing"] ?? {}) as Record<string, unknown>;
  const payments = Array.isArray(overrides["accepted_payment_types"])
    ? (overrides["accepted_payment_types"] as unknown[]).filter((v) => typeof v === "string")
    : [];
  const transferWindow = routing["transfer_window"];
  return {
    special_instructions: row.special_instructions ?? "",
    transfer_number: row.transfer_number ?? "",
    voicemail_message: str(overrides["voicemail_message"]),
    manager_name: str(overrides["manager_name"]),
    manager_phone: str(overrides["manager_phone"]),
    parking_info: str(overrides["parking_info"]),
    accessibility_notes: str(overrides["accessibility_notes"]),
    accepted_payment_types: payments.join(", "),
    transfer_window: transferWindow === "business_hours" ? "business_hours" : "any_time",
    transfer_urgent: routing["transfer_urgent"] === true,
    after_hours_phone: str(routing["after_hours_phone"]),
  };
}

/** Server issue path -> this form's field name. */
function fieldFor(path: string): string | null {
  if (path.startsWith("call_routing.")) return path.slice("call_routing.".length);
  if (path.startsWith("accepted_payment_types")) return "accepted_payment_types";
  return path.length > 0 ? path : null;
}

/**
 * Agent → AI Instructions (SETTINGS-1). Saves through
 * `POST /api/tenant/agent/instructions` (server-side E.164 + length
 * checks). The transfer number is live on the next call and can now be
 * cleared; the call-routing and "what your AI should know" fields are
 * stored but not yet read by the call engine, and say so.
 */
export default function InstructionsTabPage() {
  const tenantId = useCurrentTenantId();
  const query = useQuery({
    queryKey: ["tenant", tenantId, "agent_configs", "instructions"],
    queryFn: async (): Promise<InstructionsRow | null> => {
      const { data } = await supabaseBrowserClient
        .from("agent_configs")
        .select("special_instructions, transfer_number, dynamic_variable_overrides")
        .eq("tenant_id", tenantId as string)
        .maybeSingle();
      return data ?? null;
    },
    enabled: !!tenantId,
  });

  if (!tenantId || !query.data) return null;
  return <InstructionsForm tenantId={tenantId} row={query.data} />;
}

function InstructionsForm({ tenantId, row }: { tenantId: string; row: InstructionsRow }) {
  const queryClient = useQueryClient();
  const form = useForm<InstructionsFormValues>({
    resolver: zodResolver(instructionsFormSchema),
    defaultValues: formValuesFrom(row),
  });

  async function onSubmit(values: InstructionsFormValues) {
    const result = await sendJson("/api/tenant/agent/instructions", {
      special_instructions: values.special_instructions,
      transfer_number: values.transfer_number,
      voicemail_message: values.voicemail_message,
      manager_name: values.manager_name,
      manager_phone: values.manager_phone,
      parking_info: values.parking_info,
      accessibility_notes: values.accessibility_notes,
      accepted_payment_types: values.accepted_payment_types
        .split(/[,\n]/)
        .map((v) => v.trim())
        .filter((v) => v.length > 0),
      call_routing: {
        transfer_window: values.transfer_window,
        transfer_urgent: values.transfer_urgent,
        after_hours_phone: values.after_hours_phone,
      },
    });
    if (!result.ok) {
      applyIssues(result.issues, form.setError, fieldFor);
      toast.error(saveErrorMessage(result));
      return;
    }
    toast.success(SAVED_NEXT_CALL);
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "agent_configs"] });
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "settings_checklist"] });
  }

  const submitting = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Call transfers</CardTitle>
            <CardDescription>
              Where your AI sends callers who ask for a person. It also receives your message alerts
              if you haven&apos;t set a separate alert phone on the Delivery page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="transfer_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Transfer number</FormLabel>
                  <div className="flex flex-wrap items-center gap-2">
                    <FormControl>
                      <PhoneInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Your cell or front-desk number"
                      />
                    </FormControl>
                    {field.value && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => field.onChange("")}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <FormDescription>
                    Live from the next call. Leave empty and your AI takes a message instead of
                    transferring.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-4 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">When to transfer</p>
                <NotLiveBadge />
              </div>
              <FormField
                control={form.control}
                name="transfer_window"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Transfer callers who ask for a person</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full sm:w-80">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TRANSFER_WINDOWS.map((value) => (
                          <SelectItem key={value} value={value}>
                            {value === "any_time" ? "Any time" : "Only during business hours"}
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
                name="transfer_urgent"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4">
                    <div>
                      <FormLabel>Also transfer urgent calls right away</FormLabel>
                      <FormDescription>
                        e.g. a pet emergency or a car broken down on the road.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="after_hours_phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>After-hours number (optional)</FormLabel>
                    <FormControl>
                      <PhoneInput value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormDescription>
                      A different number to use when you&apos;re closed.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <NotLiveNote>
                Today your AI transfers any caller who asks for a person to the transfer number
                above, at any hour, and takes a message if no number is set. These choices are kept
                and apply automatically once call routing rules ship.
              </NotLiveNote>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>What your AI should know</CardTitle>
              <NotLiveBadge />
            </div>
            <CardDescription>Extra details for callers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <NotLiveNote>
              Your AI doesn&apos;t read these fields on calls yet. To give callers an answer today,
              put it in your business&apos;s vertical details (cancellation policy, tow partner,
              emergency clinic…) where it is already spoken.
            </NotLiveNote>
            <FormField
              control={form.control}
              name="special_instructions"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Special instructions</FormLabel>
                  <FormControl>
                    <Textarea rows={4} {...field} />
                  </FormControl>
                  <FormDescription>
                    e.g. “Ask every caller whether their vehicle is driveable.”
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="voicemail_message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Voicemail message</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="manager_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Manager name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="manager_phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Manager phone</FormLabel>
                    <FormControl>
                      <PhoneInput value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="parking_info"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Parking info</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="accessibility_notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Accessibility notes</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="accepted_payment_types"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment types you accept</FormLabel>
                  <FormControl>
                    <Input placeholder="Cash, Visa, Mastercard, Apple Pay" {...field} />
                  </FormControl>
                  <FormDescription>Separate with commas.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save"}
        </Button>
      </form>
    </Form>
  );
}
