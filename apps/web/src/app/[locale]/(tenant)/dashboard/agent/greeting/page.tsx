"use client";

import { type AgentGreeting, agentGreetingSchema } from "@heyloo/canonical-types";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

export default function GreetingTabPage() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["tenant", tenantId, "agent_configs", "greeting"],
    queryFn: async () => {
      const { data: tenant } = await supabaseBrowserClient
        .from("tenants")
        .select("name")
        .eq("id", tenantId as string)
        .maybeSingle();
      const { data: config } = await supabaseBrowserClient
        .from("agent_configs")
        .select("assistant_name")
        .eq("tenant_id", tenantId as string)
        .maybeSingle();
      return {
        businessName: tenant?.name ?? "your business",
        assistantName: config?.assistant_name ?? "",
      };
    },
    enabled: !!tenantId,
  });

  const form = useForm<AgentGreeting>({
    resolver: zodResolver(agentGreetingSchema),
    defaultValues: { persona_name: "" },
  });

  useEffect(() => {
    if (query.data) form.reset({ persona_name: query.data.assistantName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, form.reset]);

  async function onSubmit(values: AgentGreeting) {
    const { error } = await supabaseBrowserClient
      .from("agent_configs")
      .update({ assistant_name: values.persona_name })
      .eq("tenant_id", tenantId as string);
    if (error) {
      toast.error("Couldn't save — please try again.");
      return;
    }
    toast.success("Saved — updating your AI, ~30s");
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "agent_configs"] });
  }

  const businessName = query.data?.businessName ?? "your business";
  const personaName = form.watch("persona_name") || "your AI assistant";

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="persona_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>AI assistant name</FormLabel>
                  <FormControl>
                    <Input placeholder="Ava" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Greeting preview (read-only)
              </p>
              &quot;Hi, this is {personaName}, the AI assistant for {businessName} — this call may
              be recorded.&quot;
            </div>
            <Button type="submit">Save</Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
