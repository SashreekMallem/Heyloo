"use client";

import { Badge, DataState, formatPhoneDisplay, PageHeader } from "@heyloo/ui";
import { Globe, Phone } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { describeOutboundMessage } from "@/lib/messages/outbound-preview";
import { webChatKey } from "@/lib/messages/text-conversations";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

interface ThreadRow {
  /** Route param for this thread: a plain E.164 phone for every SMS
   * thread (unchanged — `customers`/`orders`/`bookings` pages already
   * deep-link `/dashboard/messages/<phone>` and must keep working), or
   * `webChatKey(conversationId)` for a web-chat-only conversation, which
   * has no phone at all until/unless the visitor verifies one
   * (`text_conversations.phone_e164` stays null — BACKEND_SPEC.md §13.1's
   * identity rule). See `[phone]/message-thread-client.tsx`'s own
   * docstring for how the thread page tells the two apart. */
  key: string;
  channel: "sms" | "web_chat";
  customerName: string | null;
  phone: string | null;
  smsOptOut: boolean;
  status: "open" | "human" | "closed" | null;
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
      const [{ data: inbound }, { data: outbound }, { data: conversations }] = await Promise.all([
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
        // text_conversations covers BOTH channels (BACKEND_SPEC.md §13.1) —
        // used here to (a) attach a status badge to an existing SMS thread
        // and (b) surface web-chat-only conversations, which have no
        // messages_inbound/outbound row at all (that transport is SMS-only).
        supabaseBrowserClient
          .from("text_conversations")
          .select("id, channel, phone_e164, customer_id, status, recent_turns, updated_at")
          .eq("tenant_id", tenantId)
          .order("updated_at", { ascending: false })
          .limit(300),
      ]);

      const byPhone = new Map<string, ThreadRow>();

      for (const m of inbound ?? []) {
        const existing = byPhone.get(m.from_e164);
        if (!existing) {
          byPhone.set(m.from_e164, {
            key: m.from_e164,
            channel: "sms",
            customerName: null,
            phone: m.from_e164,
            smsOptOut: false,
            status: null,
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
            key: m.recipient,
            channel: "sms",
            customerName: null,
            phone: m.recipient,
            smsOptOut: false,
            status: null,
            lastAt: m.created_at,
            preview: text,
            unhandled: false,
          });
        } else if (m.created_at > existing.lastAt) {
          existing.lastAt = m.created_at;
          existing.preview = text;
        }
      }

      const webChatRows: ThreadRow[] = [];
      for (const c of conversations ?? []) {
        const turns = (c.recent_turns ?? []) as { role: string; text: string; at: string }[];
        const lastTurn = turns.at(-1);
        if (c.channel === "sms" && c.phone_e164) {
          const existing = byPhone.get(c.phone_e164);
          if (existing) {
            existing.status = c.status;
            // The conversation row's own last-turn timestamp can be more
            // recent than anything seen in messages_inbound/outbound (e.g.
            // an agent-only STOP/HELP/YES reply recorded solely in
            // recent_turns, or the row simply landed after those queries'
            // 300-row window) — surface it whenever it's newer than what
            // the SMS tables already gave us.
            if (c.updated_at > existing.lastAt) {
              existing.lastAt = c.updated_at;
              existing.preview = lastTurn?.text ?? existing.preview;
            }
          }
          // No matching messages_inbound/outbound row yet (e.g. the very
          // first turn hasn't finished its own insert) — still surface the
          // conversation itself rather than silently dropping it.
          else {
            byPhone.set(c.phone_e164, {
              key: c.phone_e164,
              channel: "sms",
              customerName: null,
              phone: c.phone_e164,
              smsOptOut: false,
              status: c.status,
              lastAt: c.updated_at,
              preview: lastTurn?.text ?? "",
              unhandled: false,
            });
          }
          continue;
        }
        if (c.channel === "web_chat") {
          webChatRows.push({
            key: webChatKey(c.id),
            channel: "web_chat",
            customerName: null,
            phone: null,
            smsOptOut: false,
            status: c.status,
            lastAt: c.updated_at,
            preview: lastTurn?.text ?? "New web chat",
            unhandled: false,
          });
        }
      }

      const allThreads = [...byPhone.values(), ...webChatRows];

      const phones = allThreads.map((t) => t.phone).filter((p): p is string => !!p);
      const customerIds = (conversations ?? [])
        .map((c) => c.customer_id)
        .filter((id): id is string => !!id);
      const [{ data: customersByPhone }, { data: customersById }] = await Promise.all([
        phones.length
          ? supabaseBrowserClient
              .from("customers")
              .select("phone_e164, name, sms_opt_out")
              .eq("tenant_id", tenantId)
              .in("phone_e164", phones)
          : Promise.resolve({
              data: [] as { phone_e164: string; name: string | null; sms_opt_out: boolean }[],
            }),
        customerIds.length
          ? supabaseBrowserClient
              .from("customers")
              .select("id, name")
              .eq("tenant_id", tenantId)
              .in("id", customerIds)
          : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
      ]);
      for (const c of customersByPhone ?? []) {
        const row = byPhone.get(c.phone_e164);
        if (row) {
          row.customerName = c.name;
          row.smsOptOut = c.sms_opt_out;
        }
      }
      const nameById = new Map((customersById ?? []).map((c) => [c.id, c.name]));
      for (const row of webChatRows) {
        const conv = (conversations ?? []).find((c) => webChatKey(c.id) === row.key);
        if (conv?.customer_id) row.customerName = nameById.get(conv.customer_id) ?? null;
      }

      return allThreads.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
    },
    { refetchInterval: 15000 },
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Messages"
        description="Two-way texts and website chat with your customers."
      />
      <DataState
        query={query}
        empty={{
          title: "No messages yet",
          description: "Two-way texts and website chat with your customers will show up here.",
        }}
        render={(threads) => (
          <ul className="divide-y divide-border rounded-md border border-border">
            {threads.map((thread) => (
              <li key={thread.key}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/40"
                  onClick={() =>
                    router.push(`/dashboard/messages/${encodeURIComponent(thread.key)}`)
                  }
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {thread.channel === "web_chat" ? (
                      <Globe
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-label="Website chat"
                      />
                    ) : (
                      <Phone
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-label="Text message"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {thread.customerName ??
                          (thread.phone ? formatPhoneDisplay(thread.phone) : "Web visitor")}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{thread.preview}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {thread.smsOptOut && <Badge variant="destructive">Opted out</Badge>}
                    {thread.status === "human" && (
                      <Badge variant="warning">You&apos;re replying</Badge>
                    )}
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
