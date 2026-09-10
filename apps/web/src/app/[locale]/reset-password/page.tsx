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
import { useState } from "react";
import { useForm } from "react-hook-form";
import { AuthShell } from "@/components/marketing/auth-shell";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

export default function ResetPasswordRequestPage() {
  const [sent, setSent] = useState(false);
  const form = useForm<ResetPasswordRequest>({
    resolver: zodResolver(resetPasswordRequestSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ResetPasswordRequest) {
    await supabaseBrowserClient.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${window.location.origin}/reset-password/confirm`,
    });
    setSent(true);
  }

  return (
    <AuthShell
      title="Reset your password"
      description={sent ? undefined : "We'll email you a link to set a new one."}
    >
      {sent ? (
        <p className="text-center text-small text-muted-foreground">
          If that email is registered, we&apos;ve sent a reset link.
        </p>
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
            <Button type="submit" size="lg" className="w-full">
              Send reset link
            </Button>
          </form>
        </Form>
      )}
    </AuthShell>
  );
}
