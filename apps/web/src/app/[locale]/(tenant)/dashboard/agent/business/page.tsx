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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import {
  centsToDollarsInput,
  milesToInput,
  normalizeState,
  normalizeZip,
} from "@/lib/settings/business-address";
import { normalizeBusinessPhone, normalizeWebsiteUrl } from "@/lib/settings/business-contact";
import type { BusinessLocation } from "@/lib/settings/business-location";
import { applyIssues, saveErrorMessage, sendJson } from "@/lib/settings/client";
import { deliveryFeeExample } from "@/lib/settings/delivery-fee";
import { formatPhoneDisplay } from "@/lib/settings/format";
import { type BusinessProfileFormValues, businessProfileFormSchema } from "@/lib/settings/schemas";
import { allTimezones, COMMON_TIMEZONES, currentTimeIn } from "@/lib/settings/timezone";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

interface BusinessRow {
  name: string;
  timezone: string;
  retention_days: number;
  business_phone: string | null;
  website_url: string | null;
  vertical?: string | null;
  business_street?: string | null;
  business_city?: string | null;
  business_state?: string | null;
  business_zip?: string | null;
  business_lat?: number | null;
  business_lng?: number | null;
  business_location_matched?: string | null;
  delivery_radius_miles?: number | null;
  delivery_fee_base_cents?: number | null;
  delivery_fee_per_mile_cents?: number | null;
  delivery_fee_included_miles?: number | null;
  delivery_min_order_cents?: number | null;
}

const BUSINESS_COLUMNS =
  "name, timezone, retention_days, business_phone, website_url, vertical, " +
  "business_street, business_city, business_state, business_zip, business_lat, business_lng, " +
  "business_location_matched, delivery_radius_miles, delivery_fee_base_cents, " +
  "delivery_fee_per_mile_cents, delivery_fee_included_miles, delivery_min_order_cents";

const DELIVERY_FIELDS = [
  "delivery_radius_miles",
  "delivery_fee_base",
  "delivery_fee_per_mile",
  "delivery_fee_included_miles",
  "delivery_min_order",
] as const;

function LocationStatus({ location }: { location: BusinessLocation | null }) {
  if (!location) return null;
  if ("lat" in location) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Located: {location.matched_address ?? "address found"}
      </p>
    );
  }
  const text =
    location.error === "not_found"
      ? "We couldn't find this address — check it."
      : location.error === "address_incomplete"
        ? "Add the street and either the ZIP code or the city and state so we can find it."
        : "We couldn't check this address right now. We'll try again on the next delivery call.";
  return (
    <p className="text-sm text-destructive" role="alert">
      {text}
    </p>
  );
}

/**
 * Agent → Business (SETTINGS-1): the business name the AI announces in its
 * opening line (`{{business_name}}`, live from the next call) and the time
 * zone every bookable slot and spoken date uses. Both were set once at
 * checkout with no way for the owner to see or fix them. Saves through
 * `POST /api/tenant/settings/business`, which re-builds bookable times
 * when the zone changes.
 *
 * LAUNCH-forwarding: also the business phone (the line that forwards to the
 * Heyloo number; the agent's default transfer destination — the route moves
 * the transfer number along while it is still the default) and website.
 */
export default function BusinessTabPage() {
  const tenantId = useCurrentTenantId();
  const query = useQuery({
    queryKey: ["tenant", tenantId, "tenants", "business_profile"],
    queryFn: async (): Promise<BusinessRow | null> => {
      const { data } = await supabaseBrowserClient
        .from("tenants")
        .select(BUSINESS_COLUMNS)
        .eq("id", tenantId as string)
        .maybeSingle();
      return (data as BusinessRow | null) ?? null;
    },
    enabled: !!tenantId,
  });

  if (!tenantId || !query.data) return null;
  return <BusinessForm tenantId={tenantId} row={query.data} />;
}

function BusinessForm({ tenantId, row }: { tenantId: string; row: BusinessRow }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const form = useForm<BusinessProfileFormValues>({
    resolver: zodResolver(businessProfileFormSchema),
    defaultValues: {
      name: row.name,
      timezone: row.timezone,
      business_phone: row.business_phone ? formatPhoneDisplay(row.business_phone) : "",
      website_url: row.website_url ?? "",
      business_street: row.business_street ?? "",
      business_city: row.business_city ?? "",
      business_state: row.business_state ?? "",
      business_zip: row.business_zip ?? "",
      delivery_radius_miles: milesToInput(row.delivery_radius_miles),
      delivery_fee_base: centsToDollarsInput(row.delivery_fee_base_cents),
      delivery_fee_per_mile: centsToDollarsInput(row.delivery_fee_per_mile_cents),
      delivery_fee_included_miles: milesToInput(row.delivery_fee_included_miles),
      delivery_min_order: centsToDollarsInput(row.delivery_min_order_cents),
    },
  });
  const isRestaurant = row.vertical === "restaurant";
  const [location, setLocation] = useState<BusinessLocation | null>(
    typeof row.business_lat === "number" && typeof row.business_lng === "number"
      ? {
          matched_address: row.business_location_matched ?? null,
          lat: row.business_lat,
          lng: row.business_lng,
        }
      : null,
  );
  const deliveryValues = useWatch({ control: form.control, name: [...DELIVERY_FIELDS] });
  const feeExample = deliveryFeeExample({
    delivery_radius_miles: deliveryValues[0],
    delivery_fee_base: deliveryValues[1],
    delivery_fee_per_mile: deliveryValues[2],
    delivery_fee_included_miles: deliveryValues[3],
  });
  const isCommon = COMMON_TIMEZONES.some((z) => z.value === row.timezone);
  // The ~400-zone list renders only on request (a native <select> handles
  // that many options far better than a custom listbox).
  const [showAllZones, setShowAllZones] = useState(!isCommon);
  const zones = useMemo(() => {
    if (!showAllZones) return [];
    const all = allTimezones();
    // Keep a stored zone the runtime doesn't list selectable.
    return all.includes(row.timezone) ? all : [row.timezone, ...all];
  }, [showAllZones, row.timezone]);
  const timezone = useWatch({ control: form.control, name: "timezone" });
  const localTime = currentTimeIn(timezone);

  async function onSubmit(values: BusinessProfileFormValues) {
    const body: Record<string, unknown> = { ...values };
    // Delivery settings exist for restaurants only.
    if (!isRestaurant) for (const field of DELIVERY_FIELDS) delete body[field];
    const result = await sendJson<{
      timezone_changed: boolean;
      availability: { resources: number; failed: number } | null;
      business_location?: BusinessLocation | null;
    }>("/api/tenant/settings/business", body);
    if (!result.ok) {
      applyIssues(result.issues, form.setError);
      toast.error(saveErrorMessage(result));
      return;
    }
    if (result.body?.business_location !== undefined && result.body.business_location !== null) {
      setLocation(result.body.business_location);
    }
    const rebuildFailed = (result.body?.availability?.failed ?? 0) > 0;
    toast.success(
      !result.body?.timezone_changed
        ? "Saved — your AI uses the new name from the next call."
        : rebuildFailed
          ? "Saved — your bookable times finish moving to the new time zone overnight."
          : "Saved — your bookable times were rebuilt in the new time zone.",
    );
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "tenants"] });
    // The header business name comes from the server layout; re-render it.
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Business profile</CardTitle>
          <CardDescription>
            How your AI introduces your business, and the time zone for your hours and bookings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business name</FormLabel>
                    <FormControl>
                      <Input autoComplete="organization" {...field} />
                    </FormControl>
                    <FormDescription>
                      Spoken in every greeting: “Thanks for calling {field.value || "…"}.”
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="business_phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Business phone number</FormLabel>
                      <FormControl>
                        <Input
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          placeholder="(262) 755-1967"
                          {...field}
                          onBlur={() => {
                            field.onBlur();
                            const e164 = normalizeBusinessPhone(field.value);
                            if (e164) field.onChange(formatPhoneDisplay(e164));
                          }}
                        />
                      </FormControl>
                      <FormDescription>
                        The number your customers call today. It forwards to your AI, and your AI
                        transfers callers here unless you set a different transfer number.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="website_url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Website (optional)</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="url"
                          autoComplete="url"
                          autoCapitalize="none"
                          spellCheck={false}
                          placeholder="https://yourbusiness.com"
                          {...field}
                          onBlur={() => {
                            field.onBlur();
                            const url = normalizeWebsiteUrl(field.value);
                            if (url) field.onChange(url);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">Business address</legend>
                <FormField
                  control={form.control}
                  name="business_street"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Street address</FormLabel>
                      <FormControl>
                        <Input
                          autoComplete="address-line1"
                          placeholder="400 N Greenville Ave"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
                  <FormField
                    control={form.control}
                    name="business_city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input autoComplete="address-level2" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="business_state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State</FormLabel>
                        <FormControl>
                          <Input
                            autoComplete="address-level1"
                            maxLength={2}
                            placeholder="TX"
                            {...field}
                            onBlur={() => {
                              field.onBlur();
                              const state = normalizeState(field.value);
                              if (state) field.onChange(state);
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="business_zip"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ZIP code</FormLabel>
                        <FormControl>
                          <Input
                            autoComplete="postal-code"
                            inputMode="numeric"
                            placeholder="75081"
                            {...field}
                            onBlur={() => {
                              field.onBlur();
                              const zip = normalizeZip(field.value);
                              if (zip) field.onChange(zip);
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <LocationStatus location={location} />
              </fieldset>
              {isRestaurant && (
                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium">Delivery</legend>
                  <p className="text-sm text-muted-foreground">
                    Your AI checks each delivery address against this range (straight-line miles
                    from your address) and tells the caller the delivery fee.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="delivery_radius_miles"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Delivery radius (miles)</FormLabel>
                          <FormControl>
                            <Input inputMode="decimal" placeholder="5" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="delivery_min_order"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Minimum order for delivery ($)</FormLabel>
                          <FormControl>
                            <Input inputMode="decimal" placeholder="15.00" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="delivery_fee_base"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Base delivery fee ($)</FormLabel>
                          <FormControl>
                            <Input inputMode="decimal" placeholder="3.00" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="delivery_fee_included_miles"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Miles included in base fee</FormLabel>
                          <FormControl>
                            <Input inputMode="decimal" placeholder="2" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="delivery_fee_per_mile"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Fee per extra mile ($)</FormLabel>
                          <FormControl>
                            <Input inputMode="decimal" placeholder="1.00" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  {feeExample && (
                    <p className="text-sm text-muted-foreground" data-testid="delivery-fee-example">
                      {feeExample}
                    </p>
                  )}
                </fieldset>
              )}
              <FormField
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time zone</FormLabel>
                    {showAllZones ? (
                      <FormControl>
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-96"
                          value={field.value}
                          onChange={(e) => field.onChange(e.target.value)}
                        >
                          {zones.map((zone) => (
                            <option key={zone} value={zone}>
                              {zone.replaceAll("_", " ")}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                    ) : (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full sm:w-96">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {COMMON_TIMEZONES.map((zone) => (
                            <SelectItem key={zone.value} value={zone.value}>
                              {zone.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {!showAllZones && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto px-0"
                        onClick={() => setShowAllZones(true)}
                      >
                        Outside these zones? Show all time zones
                      </Button>
                    )}
                    <FormDescription>
                      {localTime ? `It's ${localTime} there now. ` : ""}Your hours, bookable times,
                      and the dates your AI says are all in this zone.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : "Save"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recordings and transcripts</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Call recordings and transcripts are kept for <strong>{row.retention_days} days</strong>,
          then deleted automatically. To change this,{" "}
          <Link href="/dashboard/support" className="underline">
            contact support
          </Link>
          .
        </CardContent>
      </Card>
    </div>
  );
}
