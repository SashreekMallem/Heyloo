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

export default function PartnerSettingsPage() {
  const form = useForm<ReferralPayoutMethod>({
    resolver: zodResolver(referralPayoutMethodSchema),
    defaultValues: { paypal_email: "" },
  });

  async function onSubmit(values: ReferralPayoutMethod) {
    const {
      data: { user },
    } = await supabaseBrowserClient.auth.getUser();
    if (!user) return;
    const { error } = await supabaseBrowserClient
      .from("referral_partners")
      .update({ paypal_email: values.paypal_email, payout_method: "paypal" })
      .eq("user_id", user.id);
    if (error) toast.error("Couldn't save — please try again.");
    else toast.success("Saved");
  }

  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>
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
                      <Input type="email" {...field} />
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
    </div>
  );
}
