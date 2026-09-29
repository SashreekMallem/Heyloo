"use client";

import { type ReferralPayoutMethod, referralPayoutMethodSchema } from "@heyloo/canonical-types";
import {
  Button,
  Card,
  CardContent,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Partner payout settings form (FRONTEND_SPEC.md §8.5). `initialEmail` is the
 * partner's saved `paypal_email`, read server-side by the page so the field is
 * pre-filled and the partner can see where their money goes (PT-02).
 */
export function PayoutSettingsForm({
  partnerId,
  initialEmail,
}: {
  partnerId: string;
  initialEmail: string;
}) {
  const form = useForm<ReferralPayoutMethod>({
    resolver: zodResolver(referralPayoutMethodSchema),
    defaultValues: { paypal_email: initialEmail },
  });

  async function onSubmit(values: ReferralPayoutMethod) {
    // `.select("id")`: RLS filters a write it does not allow down to zero
    // rows with no error, so an empty result must not be reported as saved.
    const { data, error } = await supabaseBrowserClient
      .from("referral_partners")
      .update({ paypal_email: values.paypal_email, payout_method: "paypal" })
      .eq("id", partnerId)
      .select("id");
    if (error || !data || data.length === 0) {
      toast.error("Couldn't save — please try again.");
      return;
    }
    form.reset({ paypal_email: values.paypal_email });
    toast.success("Saved");
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="paypal_email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>PayPal email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit">Save</Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
