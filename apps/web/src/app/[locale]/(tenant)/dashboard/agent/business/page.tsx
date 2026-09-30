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
import { normalizeBusinessPhone, normalizeWebsiteUrl } from "@/lib/settings/business-contact";
import { applyIssues, saveErrorMessage, sendJson } from "@/lib/settings/client";
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
        .select("name, timezone, retention_days, business_phone, website_url")
        .eq("id", tenantId as string)
        .maybeSingle();
      return data ?? null;
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
    },
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
    const result = await sendJson<{
      timezone_changed: boolean;
      availability: { resources: number; failed: number } | null;
    }>("/api/tenant/settings/business", values);
    if (!result.ok) {
      applyIssues(result.issues, form.setError);
      toast.error(saveErrorMessage(result));
      return;
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
