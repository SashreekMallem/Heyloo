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
    <div className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      {sent ? (
        <p className="text-sm text-muted-foreground">
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
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full">
              Send reset link
            </Button>
          </form>
        </Form>
      )}
    </div>
  );
}
