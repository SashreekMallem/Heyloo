"use client";

import { type Login, loginSchema } from "@heyloo/canonical-types";
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
import { Suspense, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { AuthShell } from "@/components/marketing/auth-shell";
import { Link, useRouter } from "@/i18n/navigation";
import { sessionAssuranceFromSupabaseClient } from "@/lib/auth/claims";
import { LOGIN_ERROR_MESSAGES, loginErrorMessage } from "@/lib/auth/login-errors";
import { roleHome } from "@/lib/auth/role-home";
import { sameOriginPath } from "@/lib/auth/same-origin-path";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

/** `/login` (FRONTEND_SPEC.md §9.1) — role-based post-login redirect. */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  // A second click while the first request is in flight must not send a second
  // token request (AUTH-06); the button's `loading` state alone can lag a tick.
  const inFlight = useRef(false);
  // AUTH-04: `/auth/confirm` sends failed or expired email links here.
  const linkFailed = searchParams.get("toast") === "confirm_failed";
  // AUTH-10: set by the reset-password confirm step after it signs the
  // recovery session out.
  const resetDone = searchParams.get("reset") === "success";

  const form = useForm<Login>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: Login) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try {
      const { data, error: signInError } =
        await supabaseBrowserClient.auth.signInWithPassword(values);
      if (signInError || !data.user) {
        setError(
          signInError
            ? loginErrorMessage({
                status: signInError.status,
                code: signInError.code,
                name: signInError.name,
              })
            : LOGIN_ERROR_MESSAGES.invalid,
        );
        return;
      }
      // SIGNUP-1 fix (docs/BUILD_NOTES.md): `data.user.app_metadata` never
      // carries the Custom Access Token Hook's tenant_id/role/platform_admin/
      // referral_partner_id — only the freshly-minted JWT's own claims do.
      const { claims, adminMfaRequired } =
        await sessionAssuranceFromSupabaseClient(supabaseBrowserClient);
      // Same-origin paths only: `?next=` is attacker-controllable (a phished
      // login link must not bounce the freshly signed-in user to another
      // site). Anything else (AUTH-01/AUTH-08) falls back to the role home.
      const next = sameOriginPath(searchParams.get("next"), window.location.origin);
      router.push(next ?? roleHome(claims, { adminMfaRequired }));
    } catch {
      // auth-js normally returns errors, but a thrown fetch failure (offline,
      // aborted request) must not leave the form silently stuck.
      setError(LOGIN_ERROR_MESSAGES.network);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <AuthShell
      title="Log in"
      description="Welcome back — pick up right where you left off."
      footer={
        <Link
          href="/reset-password"
          className="inline-flex min-h-11 items-center underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
        >
          Forgot your password?
        </Link>
      }
    >
      {linkFailed && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-border bg-secondary p-3 text-small text-foreground"
        >
          That link is invalid or has expired. Use &ldquo;Forgot your password?&rdquo; below to get
          a new one, or ask your admin to resend your invite.
        </p>
      )}
      {resetDone && (
        <p
          role="status"
          className="mb-4 rounded-md border border-border bg-secondary p-3 text-small text-foreground"
        >
          Password updated. Log in with your new password.
        </p>
      )}
      <Form {...form}>
        <form onSubmit={(event) => form.handleSubmit(onSubmit)(event)} className="space-y-4">
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
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="current-password" {...field} />
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
          <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
            Log in
          </Button>
        </form>
      </Form>
    </AuthShell>
  );
}
