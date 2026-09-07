"use client";

import { type Login, loginSchema } from "@heyloo/canonical-types";
import { extractClaims } from "@heyloo/supabase-client";
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
import { Link, useRouter } from "@/i18n/navigation";
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
    const claims = extractClaims(data.user.app_metadata);
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
    <div className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">Log in</h1>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full">
            Log in
          </Button>
        </form>
      </Form>
      <Link href="/reset-password" className="text-center text-sm underline">
        Forgot your password?
      </Link>
    </div>
  );
}
