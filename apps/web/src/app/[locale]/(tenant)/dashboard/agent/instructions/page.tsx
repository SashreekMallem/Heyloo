"use client";

import { type AiInstructions, aiInstructionsSchema } from "@heyloo/canonical-types";
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
  PhoneInput,
  Textarea,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

export default function InstructionsTabPage() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["tenant", tenantId, "agent_configs", "instructions"],
    queryFn: async () => {
      const { data } = await supabaseBrowserClient
        .from("agent_configs")
        .select("special_instructions, transfer_number, dynamic_variable_overrides")
        .eq("tenant_id", tenantId as string)
        .maybeSingle();
      return data;
    },
    enabled: !!tenantId,
  });

  const form = useForm<AiInstructions>({
    resolver: zodResolver(aiInstructionsSchema),
    defaultValues: {},
  });

  useEffect(() => {
    if (query.data) {
      const overrides = (query.data.dynamic_variable_overrides ?? {}) as Partial<AiInstructions>;
      form.reset({
        special_instructions: query.data.special_instructions ?? undefined,
        transfer_number: query.data.transfer_number ?? undefined,
        voicemail_message: overrides.voicemail_message,
        manager_name: overrides.manager_name,
        manager_phone: overrides.manager_phone,
        parking_info: overrides.parking_info,
        accessibility_notes: overrides.accessibility_notes,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, form.reset]);

  async function onSubmit(values: AiInstructions) {
    const overrides = (query.data?.dynamic_variable_overrides ?? {}) as Record<string, unknown>;
    const { error } = await supabaseBrowserClient
      .from("agent_configs")
      .update({
        special_instructions: values.special_instructions ?? null,
        transfer_number: values.transfer_number ?? null,
        dynamic_variable_overrides: {
          ...overrides,
          voicemail_message: values.voicemail_message,
          manager_name: values.manager_name,
          manager_phone: values.manager_phone,
          parking_info: values.parking_info,
          accessibility_notes: values.accessibility_notes,
        },
      })
      .eq("tenant_id", tenantId as string);
    if (error) {
      toast.error("Couldn't save — please try again.");
      return;
    }
    toast.success("Saved — updating your AI, ~30s");
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "agent_configs"] });
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="special_instructions"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Special instructions</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="transfer_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Transfer number</FormLabel>
                  <FormControl>
                    <PhoneInput value={field.value ?? ""} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="voicemail_message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Voicemail message</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="manager_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Manager name</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="manager_phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Manager phone</FormLabel>
                  <FormControl>
                    <PhoneInput value={field.value ?? ""} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="parking_info"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Parking info</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="accessibility_notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Accessibility notes</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ""} />
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
