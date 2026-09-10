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
import { useState } from "react";
import { useForm } from "react-hook-form";
import { AuthShell } from "@/components/marketing/auth-shell";
import { useRouter } from "@/i18n/navigation";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

export default function ResetPasswordConfirmPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ResetPasswordConfirm>({
    resolver: zodResolver(resetPasswordConfirmSchema),
    defaultValues: { password: "", confirm_password: "" },
  });

  async function onSubmit(values: ResetPasswordConfirm) {
    const { error: updateError } = await supabaseBrowserClient.auth.updateUser({
      password: values.password,
    });
    if (updateError) {
      setError("Couldn't reset your password — the link may have expired.");
      return;
    }
    router.push("/login");
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
          {error && <p className="text-small text-destructive">{error}</p>}
          <Button type="submit" size="lg" className="w-full">
            Set password
          </Button>
        </form>
      </Form>
    </AuthShell>
  );
}
