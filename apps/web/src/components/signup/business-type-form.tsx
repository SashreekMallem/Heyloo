"use client";

import { signupBusinessTypeSchema, type Vertical } from "@heyloo/canonical-types";
import {
  Button,
  cn,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  VerticalIcon,
  WizardStepper,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { VERTICAL_CONTENT } from "@/content/marketing/verticals";
import { useRouter } from "@/i18n/navigation";
import { SIGNUP_STEPS } from "@/lib/marketing/signup-steps";
import {
  normalizeBusinessPhone,
  normalizeWebsiteUrl,
  zBusinessPhoneFormField,
  zWebsiteFormField,
} from "@/lib/settings/business-contact";
import { formatPhoneDisplay } from "@/lib/settings/format";

/**
 * Step 1's form: the canonical schema with the business phone and website
 * as plain friendly-input strings (blank allowed). They are normalized on
 * submit, and again by `/api/signup/draft` (the real boundary).
 */
const businessInfoFormSchema = signupBusinessTypeSchema.extend({
  business_phone: zBusinessPhoneFormField,
  website_url: zWebsiteFormField,
});
type BusinessInfoFormValues = z.infer<typeof businessInfoFormSchema>;

export function BusinessTypeForm({
  initialVertical,
  initialBusinessName,
  initialBusinessPhone,
  initialWebsiteUrl,
  demoId,
}: {
  initialVertical?: Vertical;
  /** From the signed draft cookie, so Back from a later step shows what they already entered. */
  initialBusinessName?: string;
  /** E.164 from the draft cookie; shown as "(262) 755-1967". */
  initialBusinessPhone?: string;
  initialWebsiteUrl?: string;
  demoId?: string;
}) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<BusinessInfoFormValues>({
    resolver: zodResolver(businessInfoFormSchema),
    defaultValues: {
      business_type: initialVertical ?? "generic",
      business_name: initialBusinessName ?? "",
      business_phone: initialBusinessPhone ? formatPhoneDisplay(initialBusinessPhone) : "",
      website_url: initialWebsiteUrl ?? "",
    },
  });

  async function onSubmit(values: BusinessInfoFormValues) {
    setSubmitError(null);
    try {
      const res = await fetch("/api/signup/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          business_type: values.business_type,
          business_name: values.business_name,
          business_phone: normalizeBusinessPhone(values.business_phone) ?? undefined,
          website_url: normalizeWebsiteUrl(values.website_url) ?? undefined,
          demo_id: demoId,
        }),
      });
      if (res.ok) {
        router.push("/signup/plan");
        return;
      }
    } catch {
      // fall through to the visible error below
    }
    setSubmitError("We couldn't save your details. Please try again in a moment.");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-1.5 text-center">
        <h1 className="font-display text-h2 font-semibold">
          Let&apos;s set up your AI receptionist
        </h1>
        <p className="text-small text-muted-foreground">
          Six quick steps — most take under a minute.
        </p>
      </div>
      <WizardStepper steps={SIGNUP_STEPS} current={0} completed={[]} />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="business_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>What kind of business do you run?</FormLabel>
                <fieldset
                  aria-label="Business type"
                  className="m-0 grid min-w-0 grid-cols-2 gap-3 border-0 p-0 sm:grid-cols-3"
                >
                  {VERTICAL_CONTENT.map((v) => (
                    <button
                      key={v.vertical}
                      type="button"
                      aria-pressed={field.value === v.vertical}
                      onClick={() => field.onChange(v.vertical)}
                      className={cn(
                        "flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border p-4 text-center text-small transition-colors duration-(--duration-fast) ease-(--ease-out)",
                        field.value === v.vertical
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:border-primary/40 hover:bg-secondary",
                      )}
                    >
                      <VerticalIcon
                        vertical={v.vertical}
                        className={cn(
                          "size-5",
                          field.value === v.vertical ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      {v.slug === "generic" ? "Something else" : v.displayName}
                    </button>
                  ))}
                </fieldset>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="business_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Business name</FormLabel>
                <FormControl>
                  <Input placeholder="Sunrise Group" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-6 sm:grid-cols-2">
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
                        // Show the number the way we read it back: "(262) 755-1967".
                        const e164 = normalizeBusinessPhone(field.value);
                        if (e164) field.onChange(formatPhoneDisplay(e164));
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    The number your customers call today. We&apos;ll forward it to your AI
                    receptionist.
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
                    {/* type="text", not "url": the browser's own URL check would
                        refuse "yourbusiness.com", which we accept. */}
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
          {submitError && (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full">
            Continue
          </Button>
        </form>
      </Form>
    </div>
  );
}
