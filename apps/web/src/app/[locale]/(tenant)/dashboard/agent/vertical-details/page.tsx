"use client";

import { reminderReviewSettingsSchema, verticalDetailsSchema } from "@heyloo/canonical-types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataState,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Separator,
  Switch,
  Textarea,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

/** One line per array entry — parsed on submit, joined on load (MASTER_SPEC.md §3.5 list-typed fields: insurances_accepted, species_treated, vehicle_makes_serviced, practice_areas). */
function linesToArray(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function arrayToLines(value: string[] | undefined): string {
  return (value ?? []).join("\n");
}

/** Simple `key: number` per line editor for `rate_table` (motel room/rate names -> cents-free dollar rate; MASTER_SPEC §3.5). */
function rateTableToLines(value: Record<string, number> | undefined): string {
  return Object.entries(value ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function linesToRateTable(value: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of value.split("\n")) {
    const [key, rest] = line.split(":");
    const num = Number.parseFloat((rest ?? "").trim());
    if (key?.trim() && Number.isFinite(num)) out[key.trim()] = num;
  }
  return out;
}

/**
 * Plain (unbranded) mirrors of `verticalDetailsSchema`/
 * `reminderReviewSettingsSchema`'s cents fields for react-hook-form's
 * generic — `zCents`'s branded `Cents` output type is a schema OUTPUT
 * concern (server-side, post-parse); the form itself only ever holds plain
 * numbers, matching what `zodResolver` actually type-checks against
 * (the schema's INPUT type, pre-transform).
 */
interface VerticalDetailsFormValues {
  cancellation_policy: { window_hours: number; fee_cents?: number; text: string };
  insurances_accepted?: string[];
  species_treated?: string[];
  emergency_referral?: { name: string; phone: string };
  tow_partner?: { name: string; phone: string };
  vehicle_makes_serviced?: string[];
  practice_areas?: string[];
  consult_fee_cents?: number;
  deposit_policy?: string;
  rate_table?: Record<string, number>;
  delivery_radius_m?: number;
  min_order_cents?: number;
}

interface ReminderReviewFormValues {
  voice_reminders_enabled: boolean;
  review_request_enabled: boolean;
  review_url?: string;
  avg_transaction_value_cents: number;
}

interface VerticalDetailsData {
  vertical: string;
  details: Partial<VerticalDetailsFormValues>;
  reminderReview: ReminderReviewFormValues;
}

export default function VerticalDetailsTabPage() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();

  const query = useTenantQuery(
    tenantId ?? "",
    "vertical_details",
    [],
    async (): Promise<VerticalDetailsData> => {
      const [{ data: tenant }, { data: config }] = await Promise.all([
        supabaseBrowserClient
          .from("tenants")
          .select(
            "vertical, voice_reminders_enabled, review_request_enabled, review_url, avg_transaction_value_cents",
          )
          .eq("id", tenantId as string)
          .maybeSingle(),
        supabaseBrowserClient
          .from("agent_configs")
          .select("dynamic_variable_overrides")
          .eq("tenant_id", tenantId as string)
          .maybeSingle(),
      ]);
      return {
        vertical: (tenant?.vertical as string) ?? "generic",
        details: (config?.dynamic_variable_overrides ?? {}) as Partial<VerticalDetailsFormValues>,
        reminderReview: {
          voice_reminders_enabled: tenant?.voice_reminders_enabled ?? false,
          review_request_enabled: tenant?.review_request_enabled ?? false,
          review_url: tenant?.review_url ?? undefined,
          avg_transaction_value_cents: tenant?.avg_transaction_value_cents ?? 0,
        },
      };
    },
    { enabled: !!tenantId },
  );

  return (
    <DataState
      query={query}
      empty={{ title: "Nothing here yet" }}
      render={(data) => (
        <VerticalDetailsForm
          tenantId={tenantId as string}
          data={data}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] })}
        />
      )}
    />
  );
}

function VerticalDetailsForm({
  tenantId,
  data,
  onSaved,
}: {
  tenantId: string;
  data: VerticalDetailsData;
  onSaved: () => void;
}) {
  const detailsForm = useForm<VerticalDetailsFormValues>({
    resolver: zodResolver(verticalDetailsSchema),
    defaultValues: {
      cancellation_policy: data.details.cancellation_policy ?? { window_hours: 24, text: "" },
    },
  });

  const reminderForm = useForm<ReminderReviewFormValues>({
    resolver: zodResolver(reminderReviewSettingsSchema),
    defaultValues: data.reminderReview,
  });

  useEffect(() => {
    detailsForm.reset({
      cancellation_policy: data.details.cancellation_policy ?? { window_hours: 24, text: "" },
      insurances_accepted: data.details.insurances_accepted,
      species_treated: data.details.species_treated,
      emergency_referral: data.details.emergency_referral,
      tow_partner: data.details.tow_partner,
      vehicle_makes_serviced: data.details.vehicle_makes_serviced,
      practice_areas: data.details.practice_areas,
      consult_fee_cents: data.details.consult_fee_cents,
      deposit_policy: data.details.deposit_policy,
      rate_table: data.details.rate_table,
      delivery_radius_m: data.details.delivery_radius_m,
      min_order_cents: data.details.min_order_cents,
    });
    reminderForm.reset(data.reminderReview);
  }, [data, detailsForm, reminderForm]);

  async function saveDetails(values: VerticalDetailsFormValues) {
    const res = await fetch("/api/tenant/agent/vertical-details", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      toast.error("Couldn't save — please try again.");
      return;
    }
    toast.success("Saved — updating your AI, ~30s");
    onSaved();
  }

  async function saveReminders(values: ReminderReviewFormValues) {
    const res = await fetch("/api/tenant/settings/reminders-review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      toast.error("Couldn't save — please try again.");
      return;
    }
    toast.success("Saved");
    onSaved();
  }

  const vertical = data.vertical;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Vertical details</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...detailsForm}>
            <form
              onSubmit={detailsForm.handleSubmit(saveDetails)}
              className="space-y-4"
              data-tenant-id={tenantId}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={detailsForm.control}
                  name="cancellation_policy.window_hours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cancellation window (hours)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          value={field.value ?? 0}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={detailsForm.control}
                  name="cancellation_policy.fee_cents"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Late-cancellation fee (cents, optional)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === "" ? undefined : Number(e.target.value),
                            )
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={detailsForm.control}
                name="cancellation_policy.text"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cancellation policy (spoken by the agent)</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormDescription>
                      Stated at booking and again if the customer cancels.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {vertical === "dental" && (
                <FormField
                  control={detailsForm.control}
                  name="insurances_accepted"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Insurances accepted (one per line)</FormLabel>
                      <FormControl>
                        <Textarea
                          value={arrayToLines(field.value)}
                          onChange={(e) => field.onChange(linesToArray(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {vertical === "vet" && (
                <>
                  <FormField
                    control={detailsForm.control}
                    name="species_treated"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Species treated (one per line)</FormLabel>
                        <FormControl>
                          <Textarea
                            value={arrayToLines(field.value)}
                            onChange={(e) => field.onChange(linesToArray(e.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={detailsForm.control}
                      name="emergency_referral.name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Emergency referral — clinic name</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={detailsForm.control}
                      name="emergency_referral.phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Emergency referral — phone</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </>
              )}

              {vertical === "auto" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={detailsForm.control}
                      name="tow_partner.name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tow partner — name</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={detailsForm.control}
                      name="tow_partner.phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tow partner — phone</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={detailsForm.control}
                    name="vehicle_makes_serviced"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vehicle makes serviced (one per line)</FormLabel>
                        <FormControl>
                          <Textarea
                            value={arrayToLines(field.value)}
                            onChange={(e) => field.onChange(linesToArray(e.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {vertical === "legal" && (
                <>
                  <FormField
                    control={detailsForm.control}
                    name="practice_areas"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Practice areas (one per line)</FormLabel>
                        <FormControl>
                          <Textarea
                            value={arrayToLines(field.value)}
                            onChange={(e) => field.onChange(linesToArray(e.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={detailsForm.control}
                    name="consult_fee_cents"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Consultation fee (cents, optional)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value === "" ? undefined : Number(e.target.value),
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {vertical === "motel" && (
                <>
                  <FormField
                    control={detailsForm.control}
                    name="deposit_policy"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Deposit policy (spoken by the agent)</FormLabel>
                        <FormControl>
                          <Textarea {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={detailsForm.control}
                    name="rate_table"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Rate table — one `room type: rate` per line</FormLabel>
                        <FormControl>
                          <Textarea
                            value={rateTableToLines(field.value)}
                            onChange={(e) => field.onChange(linesToRateTable(e.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {vertical === "restaurant" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={detailsForm.control}
                    name="delivery_radius_m"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Delivery radius (meters)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value === "" ? undefined : Number(e.target.value),
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={detailsForm.control}
                    name="min_order_cents"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Minimum delivery order (cents)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value === "" ? undefined : Number(e.target.value),
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              <Button type="submit">Save</Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reminders &amp; reviews</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...reminderForm}>
            <form onSubmit={reminderForm.handleSubmit(saveReminders)} className="space-y-4">
              <FormField
                control={reminderForm.control}
                name="voice_reminders_enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4">
                    <div>
                      <FormLabel>Voice appointment reminders</FormLabel>
                      <FormDescription>
                        An outbound call with voicemail detection, ~24h before each booking.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <Separator />
              <FormField
                control={reminderForm.control}
                name="review_request_enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4">
                    <div>
                      <FormLabel>Request a review after completed bookings</FormLabel>
                      <FormDescription>
                        One SMS per customer, at most once every 90 days.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={reminderForm.control}
                name="review_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Review link</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://g.page/r/..."
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={reminderForm.control}
                name="avg_transaction_value_cents"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Average transaction value (cents)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        value={field.value ?? 0}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormDescription>
                      Feeds your weekly &quot;value saved&quot; summary.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit">Save</Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
