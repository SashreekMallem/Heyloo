"use client";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
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
import { z } from "zod";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

const intakeFormSchema = z.object({
  date_of_birth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
    .refine((v) => new Date(v).getTime() < Date.now(), "Date of birth must be in the past"),
  insurance_provider: z.string().trim().max(200).optional(),
  insurance_member_id: z.string().trim().max(100).optional(),
  insurance_group_id: z.string().trim().max(100).optional(),
  consent: z.literal(true, { error: "Please confirm to continue" }),
});

type IntakeFormValues = z.infer<typeof intakeFormSchema>;

export function IntakeFormClient({
  token,
  tenantName,
  patientFirstName,
  alreadySubmitted,
}: {
  token: string;
  tenantName: string;
  patientFirstName: string | null;
  alreadySubmitted: boolean;
}) {
  const [submitted, setSubmitted] = useState(alreadySubmitted);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<IntakeFormValues>({
    resolver: zodResolver(intakeFormSchema),
    defaultValues: {
      date_of_birth: "",
      insurance_provider: "",
      insurance_member_id: "",
      insurance_group_id: "",
      consent: undefined,
    },
  });

  async function submit(values: IntakeFormValues) {
    setError(null);
    // `api-intake` (Cluster G) — single function, internal path routing by
    // token, matching the same pattern `admin/handler.ts` already uses
    // (docs/audit/FIX_REQUESTS.md carries the exact request/response
    // contract this form is built against).
    const { error: invokeError, data } = await supabaseBrowserClient.functions.invoke(
      `api-intake/${token}`,
      {
        method: "POST",
        body: {
          date_of_birth: values.date_of_birth,
          insurance_provider: values.insurance_provider || undefined,
          insurance_member_id: values.insurance_member_id || undefined,
          insurance_group_id: values.insurance_group_id || undefined,
        },
      },
    );
    if (invokeError || (data && (data as { ok?: boolean }).ok === false)) {
      const reason = (data as { error?: string } | null)?.error;
      setError(
        reason === "expired"
          ? "This link has expired — please ask us to send you a new one."
          : reason === "already_submitted"
            ? "This information was already submitted."
            : "Something went wrong — please try again.",
      );
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Thank you{patientFirstName ? `, ${patientFirstName}` : ""}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Your information has been received by {tenantName}. You&apos;re all set for your
            appointment.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Patient intake — {tenantName}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {patientFirstName ? `Hi ${patientFirstName} — please` : "Please"} confirm your date of
          birth and insurance details ahead of your appointment. This link is private to you.
        </p>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
            <FormField
              control={form.control}
              name="date_of_birth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date of birth</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="insurance_provider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Insurance provider (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Delta Dental" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="insurance_member_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Member ID (optional)</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="insurance_group_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Group ID (optional)</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="consent"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value === true}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="font-normal">
                      I confirm this information is accurate and can be shared with {tenantName} for
                      my appointment.
                    </FormLabel>
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
              Submit
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
