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
  formatPhoneDisplay,
  Input,
  PhoneInput,
  Switch,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { applyIssues, saveErrorMessage, sendJson } from "@/lib/settings/client";
import { type NotificationsFormValues, notificationsFormSchema } from "@/lib/settings/schemas";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

interface AlertsRow {
  transfer_number: string | null;
  dynamic_variable_overrides: unknown;
}

const ALERT_EVENTS = [
  "A caller leaves a message",
  "A new booking or order",
  "An urgent call (emergency, breakdown, injured pet…)",
  "A caller asked for a person but the transfer didn't connect",
];

function valuesFrom(row: AlertsRow): NotificationsFormValues {
  const overrides = (row.dynamic_variable_overrides ?? {}) as Record<string, unknown>;
  const delivery = (overrides["delivery"] ?? {}) as Record<string, unknown>;
  return {
    sms_enabled: delivery["sms_enabled"] !== false,
    email_enabled: delivery["email_enabled"] !== false,
    alert_phone: typeof delivery["alert_phone"] === "string" ? delivery["alert_phone"] : "",
    notification_email:
      typeof delivery["notification_email"] === "string" ? delivery["notification_email"] : "",
  };
}

/**
 * Delivery → "Your alerts" (SETTINGS-1): who the OWNER hears from, stored
 * at `agent_configs.dynamic_variable_overrides.delivery` in the shape the
 * MESSAGING-1 owner-alert fan-out reads. Replaces the old toggles that
 * saved on every blur with no validation and had no alert phone at all.
 * Saved through `POST /api/tenant/settings/notifications` (E.164 phone,
 * real email, owner/admin only).
 */
export function OwnerAlertsCard({
  tenantId,
  textingOn = false,
}: {
  tenantId: string;
  /** Carriers approved this business for texting; false (the default) = texting is off. */
  textingOn?: boolean;
}) {
  const query = useQuery({
    queryKey: ["tenant", tenantId, "agent_configs", "owner_alerts"],
    queryFn: async (): Promise<AlertsRow | null> => {
      const { data } = await supabaseBrowserClient
        .from("agent_configs")
        .select("transfer_number, dynamic_variable_overrides")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      return data ?? null;
    },
  });
  if (!query.data) return null;
  return <OwnerAlertsForm tenantId={tenantId} row={query.data} textingOn={textingOn} />;
}

function OwnerAlertsForm({
  tenantId,
  row,
  textingOn,
}: {
  tenantId: string;
  row: AlertsRow;
  textingOn: boolean;
}) {
  const queryClient = useQueryClient();
  const form = useForm<NotificationsFormValues>({
    resolver: zodResolver(notificationsFormSchema),
    defaultValues: valuesFrom(row),
  });
  const smsEnabled = useWatch({ control: form.control, name: "sms_enabled" });
  const alertPhone = useWatch({ control: form.control, name: "alert_phone" });
  const noPhoneToText = textingOn && smsEnabled && !alertPhone && !row.transfer_number;

  async function onSubmit(values: NotificationsFormValues) {
    const result = await sendJson("/api/tenant/settings/notifications", values);
    if (!result.ok) {
      applyIssues(result.issues, form.setError);
      toast.error(saveErrorMessage(result));
      return;
    }
    toast.success("Saved — new alerts go to these contacts.");
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "agent_configs"] });
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "settings_checklist"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your alerts</CardTitle>
        <CardDescription>Where we reach you when your AI needs you.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
            <div className="space-y-3 rounded-md border border-border p-4">
              <FormField
                control={form.control}
                name="sms_enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4">
                    <FormLabel>Text me</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="alert_phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Alert phone</FormLabel>
                    <FormControl>
                      <PhoneInput value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormDescription>
                      {row.transfer_number
                        ? `Leave blank to use your transfer number, ${formatPhoneDisplay(row.transfer_number)}.`
                        : "Your cell phone. Leave blank to use your transfer number once you set one."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {!textingOn && (
                <p className="text-xs text-muted-foreground" role="note">
                  Texting is off until it&apos;s set up, so every alert is emailed to you for now,
                  whatever you choose here.
                </p>
              )}
              {noPhoneToText && (
                <p className="text-xs text-warning" role="status">
                  There&apos;s no phone to text yet — add an alert phone here or a transfer number
                  on Agent → AI Instructions.
                </p>
              )}
            </div>

            <div className="space-y-3 rounded-md border border-border p-4">
              <FormField
                control={form.control}
                name="email_enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4">
                    <FormLabel>Email me</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notification_email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Alert email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" {...field} />
                    </FormControl>
                    <FormDescription>Leave blank to use your sign-in email.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-1 text-sm">
              <p className="font-medium">You&apos;re alerted when:</p>
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                {ALERT_EVENTS.map((event) => (
                  <li key={event}>{event}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Choosing individual alert types isn&apos;t available yet. If texting isn&apos;t
                approved for your number yet, alerts are emailed instead.
              </p>
            </div>

            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Saving…" : "Save alert settings"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
