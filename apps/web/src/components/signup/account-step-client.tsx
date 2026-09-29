"use client";

import {
  type SignupAccount,
  type SignupBusinessType,
  signupAccountSchema,
} from "@heyloo/canonical-types";
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
import { SIGNUP_STEPS } from "@/lib/marketing/signup-steps";
import {
  isObfuscatedExistingUser,
  type MappedSignUpError,
  mapSignUpError,
} from "@/lib/signup/auth-errors";
import { checkoutErrorMessage, startCheckout } from "@/lib/signup/start-checkout";
import { buildSignupUserMetadata } from "@/lib/signup/user-metadata";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

/** Where the confirmation email link lands after `/auth/confirm` verifies it: the wizard resumes at checkout. */
const RESUME_PATH = "/signup/resume";

function confirmRedirectUrl(): string {
  return `${window.location.origin}/auth/confirm?next=${encodeURIComponent(RESUME_PATH)}`;
}

export function AccountStepClient({
  annual,
  whiteGlove,
  draft,
  signedInEmail,
}: {
  annual: boolean;
  whiteGlove: boolean;
  /** The step-1 answers (from the signed draft cookie), saved on the new user so the wizard can resume after email confirmation. */
  draft: SignupBusinessType;
  /** Set when the visitor already has a session (returned from a cancelled Checkout): skip account creation, go straight to payment. */
  signedInEmail?: string | undefined;
}) {
  const [error, setError] = useState<
    MappedSignUpError | { kind: "checkout"; message: string } | null
  >(null);
  const [submitting, setSubmitting] = useState(false);
  const [awaitingEmail, setAwaitingEmail] = useState<string | null>(null);
  const [resendNotice, setResendNotice] = useState<string | null>(null);

  const form = useForm<SignupAccount>({
    resolver: zodResolver(signupAccountSchema),
    defaultValues: {
      owner_name: "",
      email: "",
      password: "",
      tos_accepted: false as unknown as true,
    },
  });

  async function goToCheckout() {
    const result = await startCheckout({ annual, whiteGlove });
    if (result.ok) {
      // eslint-disable-next-line react-hooks/immutability -- hard redirect to an external (Stripe-hosted) URL from an event handler; router.push only handles internal routes
      window.location.href = result.url;
      return;
    }
    setSubmitting(false);
    setError({ kind: "checkout", message: checkoutErrorMessage(result.error) });
  }

  async function onSubmit(values: SignupAccount) {
    setSubmitting(true);
    setError(null);

    const { data: signUpData, error: signUpError } = await supabaseBrowserClient.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        data: buildSignupUserMetadata({
          ownerName: values.owner_name,
          draft,
          plan: { annual, white_glove: whiteGlove },
        }),
        emailRedirectTo: confirmRedirectUrl(),
      },
    });

    if (signUpError) {
      setSubmitting(false);
      setError(
        mapSignUpError({
          code: (signUpError as { code?: string }).code,
          status: signUpError.status,
          message: signUpError.message,
          reasons: (signUpError as { reasons?: readonly string[] }).reasons,
        }),
      );
      return;
    }
    if (isObfuscatedExistingUser(signUpData.user)) {
      // GoTrue hides "already registered" behind a success with no identities
      // (and sends no email): tell the customer instead of waiting for mail.
      setSubmitting(false);
      setError(mapSignUpError({ code: "user_already_exists" }));
      return;
    }
    if (!signUpData.session) {
      // Email confirmation required before a session exists. The confirmation
      // link brings them back through /auth/confirm to /signup/resume, which
      // continues to checkout with the vertical, business name and plan they
      // chose here.
      setSubmitting(false);
      setAwaitingEmail(values.email);
      return;
    }

    await goToCheckout();
  }

  async function onContinueSignedIn() {
    setSubmitting(true);
    setError(null);
    await goToCheckout();
  }

  async function onResend() {
    if (!awaitingEmail) return;
    setResendNotice(null);
    const { error: resendError } = await supabaseBrowserClient.auth.resend({
      type: "signup",
      email: awaitingEmail,
      options: { emailRedirectTo: confirmRedirectUrl() },
    });
    setResendNotice(
      resendError
        ? mapSignUpError({
            code: (resendError as { code?: string }).code,
            status: resendError.status,
            message: resendError.message,
          }).message
        : "We sent another confirmation email.",
    );
  }

  if (awaitingEmail) {
    return (
      <div className="mx-auto max-w-md space-y-6 text-center">
        <h1 className="font-display text-h2 font-semibold">Check your email</h1>
        <p className="text-small text-muted-foreground">
          We sent a confirmation link to <strong>{awaitingEmail}</strong>. Open it and we&apos;ll
          take you straight to payment, with your business details already filled in.
        </p>
        <div className="space-y-2">
          <Button type="button" variant="outline" onClick={onResend}>
            Resend the email
          </Button>
          {resendNotice && (
            <p className="text-small text-muted-foreground" role="status">
              {resendNotice}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (signedInEmail) {
    return (
      <div className="mx-auto max-w-md space-y-8">
        <div className="space-y-1.5 text-center">
          <h1 className="font-display text-h2 font-semibold">Continue to payment</h1>
          <p className="text-small text-muted-foreground">
            You&apos;re signed in as {signedInEmail}. Your account is ready; only payment is left.
          </p>
        </div>
        <WizardStepper steps={SIGNUP_STEPS} current={2} completed={[0, 1]} />
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error.message}
          </p>
        )}
        <Button size="lg" className="w-full" loading={submitting} onClick={onContinueSignedIn}>
          Continue to payment
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-8">
      <div className="space-y-1.5 text-center">
        <h1 className="font-display text-h2 font-semibold">Create your account</h1>
        <p className="text-small text-muted-foreground">
          You&apos;ll set up payment on the next step.
        </p>
      </div>
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
                {error?.kind === "already_registered" && (
                  <p className="text-sm text-destructive" role="alert">
                    {error.message}{" "}
                    <Link href="/login?next=/signup/resume" className="underline">
                      Log in instead
                    </Link>
                    .
                  </p>
                )}
                {error?.kind === "invalid_email" && (
                  <p className="text-sm text-destructive" role="alert">
                    {error.message}
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
                {error?.kind === "weak_password" && (
                  <p className="text-sm text-destructive" role="alert">
                    {error.message}
                  </p>
                )}
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
          {error &&
            error.kind !== "already_registered" &&
            error.kind !== "invalid_email" &&
            error.kind !== "weak_password" && (
              <p className="text-sm text-destructive" role="alert">
                {error.message}
              </p>
            )}
          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            Create account & continue
          </Button>
        </form>
      </Form>
    </div>
  );
}
