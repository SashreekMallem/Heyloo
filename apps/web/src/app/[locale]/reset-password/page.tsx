"use client";

import { type ResetPasswordRequest, resetPasswordRequestSchema } from "@heyloo/canonical-types";
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { AuthShell } from "@/components/marketing/auth-shell";
import { Link } from "@/i18n/navigation";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

export default function ResetPasswordRequestPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordRequestForm />
    </Suspense>
  );
}

function ResetPasswordRequestForm() {
  const searchParams = useSearchParams();
  // AUTH-04: `/auth/confirm` sends a failed/expired recovery link here.
  const linkExpired = searchParams.get("error") === "expired";
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const form = useForm<ResetPasswordRequest>({
    resolver: zodResolver(resetPasswordRequestSchema),
    defaultValues: { email: "" },
  });

  async function sendLink(email: string): Promise<boolean> {
    setSendError(null);
    try {
      const { error } = await supabaseBrowserClient.auth.resetPasswordForEmail(email, {
        // QA-PORTAL root-cause fix (docs/BUILD_NOTES.md): the recovery link
        // GoTrue emails redirects to `<redirectTo>?token_hash=...&
        // type=recovery`, never to a URL that already carries a session —
        // `/reset-password/confirm` calling `updateUser({password})`
        // directly failed with "Auth session missing!" for every real
        // click. `/auth/confirm` establishes the session first.
        redirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(
          "/reset-password/confirm",
        )}`,
      });
      // Only a transport failure or a rate limit is worth telling the user
      // about; "unknown address" must stay indistinguishable from success
      // (no account enumeration), so every other error looks like a send.
      if (error && (error.status === 429 || error.status === 0 || (error.status ?? 0) >= 500)) {
        setSendError(
          error.status === 429
            ? "Too many requests. Wait a minute, then try again."
            : "Connection problem. Check your internet and try again.",
        );
        return false;
      }
      return true;
    } catch {
      setSendError("Connection problem. Check your internet and try again.");
      return false;
    }
  }

  async function onSubmit(values: ResetPasswordRequest) {
    if (await sendLink(values.email)) setSentTo(values.email);
  }

  async function onResend() {
    if (!sentTo) return;
    setResending(true);
    setResent(false);
    const ok = await sendLink(sentTo);
    setResending(false);
    setResent(ok);
  }

  return (
    <AuthShell
      title="Reset your password"
      description={sentTo ? undefined : "We'll email you a link to set a new one."}
    >
      {linkExpired && !sentTo && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-border bg-secondary p-3 text-small text-foreground"
        >
          That reset link is invalid or has expired. Enter your email and we&apos;ll send a new one.
        </p>
      )}
      {sentTo ? (
        <div className="space-y-4">
          <p className="text-center text-small text-muted-foreground" role="status">
            If that email is registered, we&apos;ve sent a reset link.
            {resent ? " We just sent it again." : ""}
          </p>
          {sendError && (
            <p role="alert" className="text-center text-small text-destructive">
              {sendError}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            onClick={onResend}
            loading={resending}
          >
            Resend the link
          </Button>
          <Button asChild variant="ghost" size="lg" className="w-full">
            <Link href="/login">Back to log in</Link>
          </Button>
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {sendError && (
              <p role="alert" className="text-small text-destructive">
                {sendError}
              </p>
            )}
            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={form.formState.isSubmitting}
            >
              Send reset link
            </Button>
            <Button asChild variant="ghost" size="lg" className="w-full">
              <Link href="/login">Back to log in</Link>
            </Button>
          </form>
        </Form>
      )}
    </AuthShell>
  );
}
