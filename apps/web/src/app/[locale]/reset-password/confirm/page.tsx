"use client";

import { type ResetPasswordConfirm, resetPasswordConfirmSchema } from "@heyloo/canonical-types";
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
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { AuthShell } from "@/components/marketing/auth-shell";
import { Link, useRouter } from "@/i18n/navigation";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

type LinkState = "checking" | "valid" | "invalid";

function updateErrorMessage(code: string | undefined): string {
  if (code === "same_password") return "Choose a password you haven't used before.";
  if (code === "weak_password") return "That password is too easy to guess. Try a longer one.";
  return "Couldn't reset your password. The link may have expired, so request a new one.";
}

export default function ResetPasswordConfirmPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // AUTH-10: `/auth/confirm` establishes the recovery session before sending
  // the visitor here. Without one (link opened twice, session expired, page
  // typed by hand) the form can never succeed, so say so up front.
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const form = useForm<ResetPasswordConfirm>({
    resolver: zodResolver(resetPasswordConfirmSchema),
    defaultValues: { password: "", confirm_password: "" },
  });

  useEffect(() => {
    let cancelled = false;
    void supabaseBrowserClient.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setLinkState(session ? "valid" : "invalid");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(values: ResetPasswordConfirm) {
    setError(null);
    const { error: updateError } = await supabaseBrowserClient.auth.updateUser({
      password: values.password,
    });
    if (updateError) {
      setError(updateErrorMessage(updateError.code));
      return;
    }
    // Drop the temporary recovery session so the user signs in with the new
    // password (and MFA, for admins) rather than being left half signed-in.
    await supabaseBrowserClient.auth.signOut();
    router.push("/login?reset=success");
  }

  if (linkState === "invalid") {
    return (
      <AuthShell
        title="This link has expired"
        description="Password reset links work once and only for a short time."
      >
        <div className="space-y-4">
          <Button asChild size="lg" className="w-full">
            <Link href="/reset-password">Request a new link</Link>
          </Button>
          <Button asChild variant="ghost" size="lg" className="w-full">
            <Link href="/login">Back to log in</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set a new password">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirm_password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {error && (
            <p role="alert" className="text-small text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={form.formState.isSubmitting}
            disabled={linkState === "checking"}
          >
            Set password
          </Button>
        </form>
      </Form>
    </AuthShell>
  );
}
