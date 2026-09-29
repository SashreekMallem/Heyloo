"use client";

import {
  MESSAGING_BUSINESS_TYPES,
  type MessagingBusinessProfile,
  messagingBusinessProfileSchema,
} from "@heyloo/canonical-types";
import {
  Button,
  Callout,
  Card,
  CardContent,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  formatPhoneDisplay,
  Input,
  PageHeader,
  PhoneInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { type UseFormReturn, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { MessagingSetupResponse, TextingState } from "@/lib/messaging/texting-setup";

/**
 * MESSAGING-1 — "Text messaging" setup (docs/design/MESSAGING_PROVIDERS.md).
 * Honest status of carrier approval plus the business details US carriers
 * require before ANY provider may text customers for this business. Until
 * approval, confirmations and owner alerts are emailed instead (the
 * messages_outbound worker's fallback), which is what the copy says.
 */

const BUSINESS_TYPE_LABELS: Record<(typeof MESSAGING_BUSINESS_TYPES)[number], string> = {
  sole_proprietor: "Sole proprietor (no EIN)",
  llc: "LLC",
  corporation: "Corporation",
  partnership: "Partnership",
  nonprofit: "Nonprofit",
};

const VOLUME_OPTIONS = [
  { value: 100, label: "Up to 100 texts a month" },
  { value: 1000, label: "Up to 1,000 texts a month" },
  { value: 10000, label: "Up to 10,000 texts a month" },
  { value: 100000, label: "More than 10,000 texts a month" },
] as const;

const STATE_KEYS: Record<TextingState, true> = {
  not_started: true,
  details_submitted: true,
  in_review: true,
  active: true,
  action_needed: true,
};

const EMPTY: MessagingBusinessProfile = {
  legal_name: "",
  business_type: "llc",
  street_line1: "",
  city: "",
  region: "",
  postal_code: "",
  contact_first_name: "",
  contact_last_name: "",
  contact_email: "",
  contact_phone: "",
  monthly_volume_estimate: 1000,
};

function StatusCallout({ data }: { data: MessagingSetupResponse }): ReactNode {
  const number = data.sender ? formatPhoneDisplay(data.sender.e164) : null;
  const copy: Record<
    TextingState,
    { tone: "warning" | "info" | "success" | "danger"; title: string; body: string }
  > = {
    not_started: {
      tone: "warning",
      title: "Texting isn't set up yet",
      body: "US carriers only let a business text its customers after they approve that business. Add your details below to start. Until then, booking confirmations and alerts are emailed to you instead.",
    },
    details_submitted: {
      tone: "info",
      title: "We have your details",
      body: "We'll get you a dedicated texting number and send your details to the carriers. Approval usually takes about 1–2 weeks. You'll keep getting email alerts until it's approved.",
    },
    in_review: {
      tone: "info",
      title: "Carriers are reviewing your texting number",
      body: `${number ? `${number} is ` : "Your number is "}waiting on carrier approval, which usually takes about 1–2 weeks. You'll keep getting email alerts until it's approved.`,
    },
    active: {
      tone: "success",
      title: "Texting is on",
      body: `Customers get confirmations and replies by text${number ? ` from ${number}` : ""}.`,
    },
    action_needed: {
      tone: "danger",
      title: "Carriers didn't approve texting yet",
      body: `${data.sender?.failure_reason ? `Reason given: ${data.sender.failure_reason}. ` : ""}Check that your details below exactly match your IRS paperwork, then save them again and we'll resubmit.`,
    },
  };
  const c = copy[data.state];
  return (
    <Callout tone={c.tone} title={c.title}>
      {c.body}
    </Callout>
  );
}

function TextField({
  form,
  name,
  label,
  placeholder,
}: {
  form: UseFormReturn<MessagingBusinessProfile>;
  name: keyof MessagingBusinessProfile;
  label: string;
  placeholder?: string;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              placeholder={placeholder}
              value={typeof field.value === "string" ? field.value : ""}
              // Blank optional fields must be `undefined`, not "" (a blank
              // EIN/URL would otherwise fail its format check).
              onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.value)}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export default function TextingPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["tenant", "messaging-setup"],
    queryFn: async (): Promise<MessagingSetupResponse> => {
      const res = await fetch("/api/tenant/messaging");
      if (!res.ok) throw new Error(`messaging_setup_${res.status}`);
      // Defensive: never trust the shape at runtime (a proxy error page or
      // a stale fixture must not crash the status card).
      const json = (await res.json()) as Partial<MessagingSetupResponse> | null;
      return {
        state: json?.state && json.state in STATE_KEYS ? json.state : "not_started",
        sender: json?.sender ?? null,
        profile: json?.profile ?? null,
        can_edit: json?.can_edit === true,
      };
    },
  });

  const form = useForm<MessagingBusinessProfile>({
    resolver: zodResolver(messagingBusinessProfileSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (query.data?.profile) {
      const { submitted_at: _submittedAt, ...profile } = query.data.profile;
      form.reset(profile);
    }
  }, [query.data, form]);

  const businessType = useWatch({ control: form.control, name: "business_type" });

  async function onSubmit(values: MessagingBusinessProfile) {
    const res = await fetch("/api/tenant/messaging", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      toast.error("Couldn't save — please check the fields and try again.");
      return;
    }
    toast.success("Saved — we'll take it from here.");
    void queryClient.invalidateQueries({ queryKey: ["tenant", "messaging-setup"] });
  }

  if (query.isError) {
    return (
      <Callout tone="danger" title="Couldn't load texting setup">
        Please refresh the page.
      </Callout>
    );
  }
  if (!query.data) return null;
  const data = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Text messaging"
        description="Let your AI text customers booking confirmations, reminders, and replies."
      />

      <StatusCallout data={data} />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <h2 className="font-medium">Your business details</h2>
            <p className="text-small text-muted-foreground">
              Carriers check these against IRS records before approving texting, so use your exact
              legal name and EIN. They are only used for this registration.
            </p>
          </div>

          {!data.can_edit ? (
            <p className="text-small text-muted-foreground">
              Only the account owner or an admin can view and edit these details.
            </p>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <TextField form={form} name="legal_name" label="Legal business name" />
                </div>
                <TextField form={form} name="dba_name" label="Doing business as (optional)" />
                <FormField
                  control={form.control}
                  name="business_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Business type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {MESSAGING_BUSINESS_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {BUSINESS_TYPE_LABELS[type]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {businessType !== "sole_proprietor" && (
                  <TextField form={form} name="ein" label="EIN" placeholder="12-3456789" />
                )}
                <TextField
                  form={form}
                  name="website_url"
                  label="Website (optional)"
                  placeholder="https://"
                />
                <div className="sm:col-span-2">
                  <TextField form={form} name="street_line1" label="Street address" />
                </div>
                <TextField form={form} name="street_line2" label="Suite / unit (optional)" />
                <TextField form={form} name="city" label="City" />
                <TextField form={form} name="region" label="State" placeholder="CA" />
                <TextField form={form} name="postal_code" label="ZIP code" />
                <TextField form={form} name="contact_first_name" label="Contact first name" />
                <TextField form={form} name="contact_last_name" label="Contact last name" />
                <TextField form={form} name="contact_email" label="Contact email" />
                <FormField
                  control={form.control}
                  name="contact_phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact phone</FormLabel>
                      <FormControl>
                        <PhoneInput value={field.value ?? ""} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="monthly_volume_estimate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expected texts per month</FormLabel>
                      <Select
                        value={String(field.value)}
                        onValueChange={(value) => field.onChange(Number(value))}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {VOLUME_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={String(option.value)}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    Save details
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
