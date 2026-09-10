"use client";

import { Badge, DataState, PageHeader } from "@heyloo/ui";
import { useRouter } from "@/i18n/navigation";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { describeOutboundMessage } from "@/lib/messages/outbound-preview";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

interface ThreadRow {
  phone: string;
  customerName: string | null;
  smsOptOut: boolean;
  lastAt: string;
  preview: string;
  unhandled: boolean;
}

export function MessagesListClient({ tenantId }: { tenantId: string }) {
  const router = useRouter();

  const query = useTenantQuery(
    tenantId,
    "messages_inbound",
    ["threads"],
    async () => {
      const [{ data: inbound }, { data: outbound }] = await Promise.all([
        supabaseBrowserClient
          .from("messages_inbound")
          .select("from_e164, body, handled, created_at")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(300),
        supabaseBrowserClient
          .from("messages_outbound")
          .select("recipient, template_key, payload, created_at")
          .eq("tenant_id", tenantId)
          .eq("channel", "sms")
          .order("created_at", { ascending: false })
          .limit(300),
      ]);

      const byPhone = new Map<string, ThreadRow>();

      for (const m of inbound ?? []) {
        const existing = byPhone.get(m.from_e164);
        if (!existing) {
          byPhone.set(m.from_e164, {
            phone: m.from_e164,
            customerName: null,
            smsOptOut: false,
            lastAt: m.created_at,
            preview: m.body,
            unhandled: !m.handled,
          });
        } else {
          if (!m.handled) existing.unhandled = true;
          if (m.created_at > existing.lastAt) {
            existing.lastAt = m.created_at;
            existing.preview = m.body;
          }
        }
      }

      for (const m of outbound ?? []) {
        const existing = byPhone.get(m.recipient);
        const { text } = describeOutboundMessage(
          m.template_key,
          (m.payload ?? {}) as Record<string, unknown>,
        );
        if (!existing) {
          byPhone.set(m.recipient, {
            phone: m.recipient,
            customerName: null,
            smsOptOut: false,
            lastAt: m.created_at,
            preview: text,
            unhandled: false,
          });
        } else if (m.created_at > existing.lastAt) {
          existing.lastAt = m.created_at;
          existing.preview = text;
        }
      }

      const phones = [...byPhone.keys()];
      const { data: customers } = phones.length
        ? await supabaseBrowserClient
            .from("customers")
            .select("phone_e164, name, sms_opt_out")
            .eq("tenant_id", tenantId)
            .in("phone_e164", phones)
        : { data: [] as { phone_e164: string; name: string | null; sms_opt_out: boolean }[] };
      for (const c of customers ?? []) {
        const row = byPhone.get(c.phone_e164);
        if (row) {
          row.customerName = c.name;
          row.smsOptOut = c.sms_opt_out;
        }
      }

      return [...byPhone.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
    },
    { refetchInterval: 15000 },
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Messages" description="Two-way texts with your customers." />
      <DataState
        query={query}
        empty={{
          title: "No messages yet",
          description: "Two-way texts with your customers will show up here.",
        }}
        render={(threads) => (
          <ul className="divide-y divide-border rounded-md border border-border">
            {threads.map((thread) => (
              <li key={thread.phone}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/40"
                  onClick={() =>
                    router.push(`/dashboard/messages/${encodeURIComponent(thread.phone)}`)
                  }
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {thread.customerName ?? thread.phone}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{thread.preview}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {thread.smsOptOut && <Badge variant="destructive">Opted out</Badge>}
                    {thread.unhandled && <Badge variant="warning">New</Badge>}
                    <span className="text-xs text-muted-foreground">
                      {new Date(thread.lastAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      />
    </div>
  );
}
