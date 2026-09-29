"use client";

import { type AgentGreeting, agentGreetingSchema } from "@heyloo/canonical-types";
import {
  Button,
  Card,
  CardContent,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { browserWriteOutcome, NOT_ALLOWED_TO_CHANGE, SAVED_NEXT_CALL } from "@/lib/settings/client";
import { DEFAULT_ASSISTANT_NAME, openingLinePreview } from "@/lib/settings/greeting";
import { ReadOnlyNote } from "@/lib/settings/read-only-note";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCanWriteSettings, useCurrentTenantId } from "@/lib/tenant/tenant-context";

export default function GreetingTabPage() {
  const tenantId = useCurrentTenantId();
  const canWrite = useCanWriteSettings();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["tenant", tenantId, "agent_configs", "greeting"],
    queryFn: async () => {
      const { data: tenant } = await supabaseBrowserClient
        .from("tenants")
        .select("name, language_config")
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
        language: (tenant?.language_config as { primary?: string } | undefined)?.primary ?? "en",
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
    // Blank -> null: every reader falls back to the default name.
    const outcome = browserWriteOutcome(
      await supabaseBrowserClient
        .from("agent_configs")
        .update({ assistant_name: values.persona_name.trim() || null })
        .eq("tenant_id", tenantId as string)
        .select("tenant_id"),
    );
    if (outcome === "denied") {
      toast.error(NOT_ALLOWED_TO_CHANGE);
      return;
    }
    if (outcome === "error") {
      toast.error("Couldn't save — please try again.");
      return;
    }
    // `{{assistant_name}}` is read by voice-inbound on every call — no
    // publish needed (SETTINGS-1).
    toast.success(SAVED_NEXT_CALL);
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "agent_configs"] });
  }

  const personaName = useWatch({ control: form.control, name: "persona_name" });
  const preview = openingLinePreview({
    businessName: query.data?.businessName ?? "",
    assistantName: personaName ?? "",
    language: query.data?.language ?? "en",
  });

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <ReadOnlyNote />
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="persona_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>AI assistant name</FormLabel>
                  <FormControl>
                    <Input placeholder={DEFAULT_ASSISTANT_NAME} disabled={!canWrite} {...field} />
                  </FormControl>
                  <FormDescription>
                    If left blank, callers hear &ldquo;{DEFAULT_ASSISTANT_NAME}&rdquo;.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                What callers hear first (word for word)
              </p>
              “{preview}”
              <p className="mt-2 text-xs text-muted-foreground">
                The AI and call-recording notice is required and can&apos;t be edited. Returning
                callers may also be welcomed back by first name. To change the business name, use
                the{" "}
                <Link href="/dashboard/agent/business" className="underline">
                  Business
                </Link>{" "}
                tab.
              </p>
            </div>
            {canWrite && <Button type="submit">Save</Button>}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
