"use client";

import { type SignupAccount, signupAccountSchema } from "@heyloo/canonical-types";
import {
  Button,
  Checkbox,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Label,
  WizardStepper,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "@/i18n/navigation";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

const SIGNUP_STEPS = ["Business info", "Plan", "Account", "Payment", "Provisioning", "Phone setup"];

export function AccountStepClient({
  annual,
  whiteGlove,
}: {
  annual: boolean;
  whiteGlove: boolean;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<SignupAccount>({
    resolver: zodResolver(signupAccountSchema),
    defaultValues: {
      owner_name: "",
      email: "",
      password: "",
      tos_accepted: false as unknown as true,
    },
  });

  async function onSubmit(values: SignupAccount) {
    setSubmitting(true);
    setSubmitError(null);

    const { data: signUpData, error: signUpError } = await supabaseBrowserClient.auth.signUp({
      email: values.email,
      password: values.password,
      options: { data: { owner_name: values.owner_name } },
    });

    if (signUpError) {
      setSubmitting(false);
      if (signUpError.message.toLowerCase().includes("already registered")) {
        setSubmitError("already_registered");
      } else {
        setSubmitError(signUpError.message);
      }
      return;
    }
    if (!signUpData.session) {
      // Email confirmation required before a session exists — Supabase's
      // default auth flow; the tenant/checkout steps need an active session,
      // so surface this rather than silently stalling.
      setSubmitting(false);
      setSubmitError("confirm_email");
      return;
    }

    const checkoutRes = await fetch("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        annual,
        white_glove: whiteGlove,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    const checkout = (await checkoutRes.json()) as { url?: string; error?: string };
    if (checkoutRes.ok && checkout.url) {
      // eslint-disable-next-line react-hooks/immutability -- hard redirect to an external (Stripe-hosted) URL from an event handler; router.push only handles internal routes
      window.location.href = checkout.url;
      return;
    }

    setSubmitting(false);
    setSubmitError(checkout.error ?? "checkout_failed");
  }

  return (
    <div className="mx-auto max-w-md space-y-8">
      <WizardStepper steps={SIGNUP_STEPS} current={2} completed={[0, 1]} />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="owner_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Your name</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" {...field} />
                </FormControl>
                <FormMessage />
                {submitError === "already_registered" && (
                  <p className="text-sm text-destructive">
                    That email is already registered.{" "}
                    <Link href="/login" className="underline">
                      Log in instead
                    </Link>
                    .
                  </p>
                )}
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input type="password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="tos_accepted"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start gap-2 space-y-0">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <Label className="font-normal">
                  I agree to the{" "}
                  <Link href="/legal/terms" className="underline">
                    Terms of Service
                  </Link>
                </Label>
                <FormMessage />
              </FormItem>
            )}
          />
          {submitError && submitError !== "already_registered" && (
            <p className="text-sm text-destructive">
              {submitError === "confirm_email"
                ? "Check your email to confirm your account, then log in."
                : "Something went wrong creating your account — please try again."}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            Create account & continue
          </Button>
        </form>
      </Form>
    </div>
  );
}
