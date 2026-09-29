"use client";

import { verticalDetailsSchema } from "@heyloo/canonical-types";
import {
  BpsInput,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CentsInput,
  DataState,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  PhoneInput,
  Separator,
  Switch,
  Textarea,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { NotLiveBadge } from "@/components/tenant/settings/not-live-note";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { SAVED_NEXT_CALL, saveErrorMessage, sendJson } from "@/lib/settings/client";
import { isBlankOrValidPhone, PHONE_ERROR_MESSAGE } from "@/lib/settings/phone";
import { parseRateTable, type RateEntry, rateTableToText } from "@/lib/settings/rate-table";
import { type ReminderReviewFormValues, reminderReviewFormSchema } from "@/lib/settings/schemas";
import { detailsRequestBody } from "@/lib/settings/vertical-details";
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

/**
 * SETTINGS-1: client-side mirror of the route's contact rule
 * (`zContactRequest`) — a vet emergency referral / auto tow partner needs
 * both a name and a real phone, or neither.
 */
// SETTINGS-1 review: either half of a contact may be missing while the
// owner fills it in (the other input was never touched, or the stored
// contact was just cleared). The canonical schema requires both strings,
// which surfaced zod's raw "Invalid input: expected string, received
// undefined" instead of the real guidance below.
const zContactFormValue = z
  .object({ name: z.string().optional(), phone: z.string().optional() })
  .optional();

const detailsFormSchema = verticalDetailsSchema
  .extend({ emergency_referral: zContactFormValue, tow_partner: zContactFormValue })
  .superRefine((value, ctx) => {
    for (const key of ["emergency_referral", "tow_partner"] as const) {
      const contact = value[key];
      if (!contact) continue;
      const name = (contact.name ?? "").trim();
      const phone = (contact.phone ?? "").trim();
      if (!name && !phone) continue;
      if (!phone || !isBlankOrValidPhone(phone)) {
        ctx.addIssue({ code: "custom", message: PHONE_ERROR_MESSAGE, path: [key, "phone"] });
      }
      if (!name) {
        ctx.addIssue({
          code: "custom",
          message: "Add a name for this contact.",
          path: [key, "name"],
        });
      }
    }
  });

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
  emergency_referral?: { name?: string; phone?: string };
  tow_partner?: { name?: string; phone?: string };
  vehicle_makes_serviced?: string[];
  practice_areas?: string[];
  consult_fee_cents?: number;
  deposit_policy?: {
    required: boolean;
    amount_cents?: number;
    hold_window_hours?: number;
    text: string;
  };
  rate_table?: Array<{ room_type: string; nightly_rate_cents: number }>;
  delivery_radius_m?: number;
  min_order_cents?: number;
  delivery_fee_cents?: number;
  tax_rate_bps?: number;
  prep_time_minutes?: number;
  menu_text?: string;
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
          review_url: tenant?.review_url ?? "",
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
    resolver: zodResolver(detailsFormSchema),
    defaultValues: {
      cancellation_policy: data.details.cancellation_policy ?? { window_hours: 24, text: "" },
    },
  });

  const reminderForm = useForm<ReminderReviewFormValues>({
    resolver: zodResolver(reminderReviewFormSchema),
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
      delivery_fee_cents: data.details.delivery_fee_cents,
      tax_rate_bps: data.details.tax_rate_bps,
      prep_time_minutes: data.details.prep_time_minutes,
      menu_text: data.details.menu_text,
    });
    reminderForm.reset(data.reminderReview);
  }, [data, detailsForm, reminderForm]);

  // Motel rate table is edited as dollar text; parse errors block the save.
  const [rateTableText, setRateTableText] = useState(() =>
    rateTableToText(data.details.rate_table as RateEntry[] | undefined),
  );
  const [rateTableError, setRateTableError] = useState<string | null>(null);

  async function saveDetails(values: VerticalDetailsFormValues) {
    if (rateTableError !== null) {
      toast.error("Fix the rate table first.");
      return;
    }
    const result = await sendJson(
      "/api/tenant/agent/vertical-details",
      detailsRequestBody(data.vertical, { ...values }),
    );
    if (!result.ok) {
      for (const issue of result.issues) {
        detailsForm.setError(issue.path.join(".") as never, {
          type: "server",
          message: issue.message,
        });
      }
      toast.error(saveErrorMessage(result));
      return;
    }
    // Every field here is read by voice-inbound on each call — no publish needed.
    toast.success(SAVED_NEXT_CALL);
    onSaved();
  }

  async function saveReminders(values: ReminderReviewFormValues) {
    const result = await sendJson("/api/tenant/settings/reminders-review", values);
    if (!result.ok) {
      for (const issue of result.issues) {
        reminderForm.setError(issue.path.join(".") as never, {
          type: "server",
          message: issue.message,
        });
      }
      toast.error(saveErrorMessage(result));
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
              <div className="text-sm">
                <span className="font-medium">Cancellation window and late fee</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Your AI tells callers the window and fee together with your policy text, from the
                next call. It states them; it doesn&apos;t enforce the window or charge the fee.
              </p>
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
                      <FormLabel>Late-cancellation fee (optional)</FormLabel>
                      <FormControl>
                        <CentsInput value={field.value} onChange={field.onChange} />
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
                      {vertical === "legal"
                        ? "Stated when a consultation is confirmed, cancelled or rescheduled, or when the caller asks."
                        : "Stated at booking and again if the customer cancels."}
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
                      <FormLabel className="flex flex-wrap items-center gap-2">
                        Insurances accepted (one per line)
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          value={arrayToLines(field.value)}
                          onChange={(e) => field.onChange(linesToArray(e.target.value))}
                        />
                      </FormControl>
                      <FormDescription>
                        Your AI confirms a plan only if it&apos;s on this list, and never promises
                        coverage or what a plan will pay. Applies from the next call.
                      </FormDescription>
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
                            <PhoneInput value={field.value ?? ""} onChange={field.onChange} />
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
                            <PhoneInput value={field.value ?? ""} onChange={field.onChange} />
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
                        <FormLabel>Consultation fee (optional)</FormLabel>
                        <FormControl>
                          <CentsInput value={field.value} onChange={field.onChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {vertical === "motel" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <FormField
                      control={detailsForm.control}
                      name="deposit_policy.required"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between gap-4 sm:col-span-3">
                          <FormLabel>Deposit required at booking</FormLabel>
                          <FormControl>
                            <Switch
                              checked={field.value ?? false}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={detailsForm.control}
                      name="deposit_policy.amount_cents"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Deposit amount (optional)</FormLabel>
                          <FormControl>
                            <CentsInput value={field.value} onChange={field.onChange} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={detailsForm.control}
                      name="deposit_policy.hold_window_hours"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Held-but-unpaid window (hours, optional)</FormLabel>
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
                          <FormDescription>
                            Your AI quotes pickup as &ldquo;around&rdquo; the current time plus
                            this, from the next call.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={detailsForm.control}
                    name="deposit_policy.text"
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
                        <FormLabel>Nightly rates — one “Room type: $price” per line</FormLabel>
                        <FormControl>
                          <Textarea
                            value={rateTableText}
                            placeholder={"Standard: $89\nKing Suite: $129.50"}
                            onChange={(e) => {
                              setRateTableText(e.target.value);
                              const parsed = parseRateTable(e.target.value);
                              setRateTableError(parsed.errors[0] ?? null);
                              field.onChange(parsed.entries);
                            }}
                          />
                        </FormControl>
                        <FormDescription>
                          Your AI quotes only these rates. Use the same room type names as your
                          rooms in Setup → Resources.
                        </FormDescription>
                        {rateTableError && (
                          <p className="text-sm text-destructive" role="alert">
                            {rateTableError}
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {vertical === "restaurant" && (
                <>
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
                          <FormLabel>Minimum delivery order</FormLabel>
                          <FormControl>
                            <CentsInput value={field.value} onChange={field.onChange} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={detailsForm.control}
                      name="delivery_fee_cents"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Delivery fee</FormLabel>
                          <FormControl>
                            <CentsInput value={field.value} onChange={field.onChange} />
                          </FormControl>
                          <FormDescription>Leave blank for free delivery.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={detailsForm.control}
                      name="tax_rate_bps"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Sales tax rate</FormLabel>
                          <FormControl>
                            <BpsInput value={field.value} onChange={field.onChange} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={detailsForm.control}
                      name="prep_time_minutes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex flex-wrap items-center gap-2">
                            Typical prep time (minutes)
                          </FormLabel>
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
                    name="menu_text"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Menu override (spoken by the agent)</FormLabel>
                        <FormControl>
                          <Textarea {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormDescription>
                          Leave blank to have the agent read from your active menu items instead.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
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
                      <FormLabel className="flex flex-wrap items-center gap-2">
                        Voice appointment reminders <NotLiveBadge />
                      </FormLabel>
                      <FormDescription>
                        A reminder call ~24h before each booking — not available yet. Customers who
                        agreed to texts already get a reminder text ~24h before.
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
                    <FormDescription>Required to send review requests.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={reminderForm.control}
                name="avg_transaction_value_cents"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Average transaction value</FormLabel>
                    <FormControl>
                      <CentsInput
                        value={field.value}
                        onChange={(cents) => field.onChange(cents ?? 0)}
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
