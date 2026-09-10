"use client";

import { messageReplySchema } from "@heyloo/canonical-types";
import {
  Badge,
  Button,
  DataState,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  PageHeader,
  Textarea,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { describeOutboundMessage } from "@/lib/messages/outbound-preview";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

const replyFormSchema = z.object({ body: messageReplySchema.shape.body });
type ReplyFormValues = z.infer<typeof replyFormSchema>;

interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  text: string;
  createdAt: string;
}

interface ThreadData {
  messages: ThreadMessage[];
  customerName: string | null;
  smsOptOut: boolean;
}

export function MessageThreadClient({ tenantId, phone }: { tenantId: string; phone: string }) {
  const queryClient = useQueryClient();

  const query = useTenantQuery(
    tenantId,
    "messages_inbound",
    ["thread", phone],
    async (): Promise<ThreadData> => {
      const [{ data: inbound }, { data: outbound }, { data: customer }] = await Promise.all([
        supabaseBrowserClient
          .from("messages_inbound")
          .select("id, body, created_at")
          .eq("tenant_id", tenantId)
          .eq("from_e164", phone)
          .order("created_at", { ascending: true }),
        supabaseBrowserClient
          .from("messages_outbound")
          .select("id, template_key, payload, created_at")
          .eq("tenant_id", tenantId)
          .eq("channel", "sms")
          .eq("recipient", phone)
          .order("created_at", { ascending: true }),
        supabaseBrowserClient
          .from("customers")
          .select("name, sms_opt_out")
          .eq("tenant_id", tenantId)
          .eq("phone_e164", phone)
          .maybeSingle(),
      ]);

      const messages: ThreadMessage[] = [
        ...(inbound ?? []).map((m) => ({
          id: m.id,
          direction: "inbound" as const,
          text: m.body,
          createdAt: m.created_at,
        })),
        ...(outbound ?? []).map((m) => {
          const { text } = describeOutboundMessage(
            m.template_key,
            (m.payload ?? {}) as Record<string, unknown>,
          );
          return { id: m.id, direction: "outbound" as const, text, createdAt: m.created_at };
        }),
      ].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

      return {
        messages,
        customerName: customer?.name ?? null,
        smsOptOut: customer?.sms_opt_out ?? false,
      };
    },
    // No broadcast trigger on messages_inbound/outbound yet (docs/audit/FIX_REQUESTS.md) —
    // polling keeps the thread reasonably live in the meantime.
    { refetchInterval: 15000 },
  );

  const form = useForm<ReplyFormValues>({
    resolver: zodResolver(replyFormSchema),
    defaultValues: { body: "" },
  });

  async function onSubmit(values: ReplyFormValues) {
    const res = await fetch(`/api/tenant/messages/${encodeURIComponent(phone)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(
        body.error === "opted_out"
          ? "This customer has opted out of texts."
          : "Couldn't send — please try again.",
      );
      return;
    }
    toast.success("Message queued");
    form.reset({ body: "" });
    void queryClient.invalidateQueries({
      queryKey: ["tenant", tenantId, "messages_inbound", "thread", phone],
    });
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <DataState
        query={query}
        empty={{ title: "No messages with this number yet" }}
        render={(data) => (
          <>
            <PageHeader
              title={data.customerName ?? phone}
              description={data.customerName ? phone : undefined}
              actions={
                data.smsOptOut ? <Badge variant="destructive">Opted out of texts</Badge> : undefined
              }
            />
            <div className="flex-1 space-y-2 overflow-y-auto rounded-md border border-border p-3">
              {data.messages.map((m) => (
                <div
                  key={m.id}
                  className={m.direction === "inbound" ? "flex justify-start" : "flex justify-end"}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      m.direction === "inbound" ? "bg-muted" : "bg-primary text-primary-foreground"
                    }`}
                  >
                    <p>{m.text}</p>
                    <p className="mt-1 text-[10px] opacity-70">
                      {new Date(m.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            {data.smsOptOut ? (
              <p className="text-sm text-muted-foreground">
                This customer opted out of texts — replies are disabled.
              </p>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="flex gap-2">
                  <FormField
                    control={form.control}
                    name="body"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <Textarea placeholder="Type a reply…" rows={2} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    Send
                  </Button>
                </form>
              </Form>
            )}
          </>
        )}
      />
    </div>
  );
}
