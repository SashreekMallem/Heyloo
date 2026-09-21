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
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { AuthShell } from "@/components/marketing/auth-shell";
import { Link, useRouter } from "@/i18n/navigation";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
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

  const form = useForm<Login>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: Login) {
    setError(null);
    const { data, error: signInError } =
      await supabaseBrowserClient.auth.signInWithPassword(values);
    if (signInError || !data.user) {
      setError("Incorrect email or password.");
      return;
    }
    // SIGNUP-1 fix (docs/BUILD_NOTES.md): `data.user.app_metadata` never
    // carries the Custom Access Token Hook's tenant_id/role/platform_admin/
    // referral_partner_id — only the freshly-minted JWT's own claims do.
    const claims = await claimsFromSupabaseClient(supabaseBrowserClient);
    const next = searchParams.get("next");
    if (next) {
      router.push(next);
    } else if (claims.platform_admin) {
      router.push("/cockpit");
    } else if (claims.referral_partner_id) {
      router.push("/portal");
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <AuthShell
      title="Log in"
      description="Welcome back — pick up right where you left off."
      footer={
        <Link
          href="/reset-password"
          className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
        >
          Forgot your password?
        </Link>
      }
    >
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
          {error && <p className="text-small text-destructive">{error}</p>}
          <Button type="submit" size="lg" className="w-full">
            Log in
          </Button>
        </form>
      </Form>
    </AuthShell>
  );
}
