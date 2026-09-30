"use client";

import { E164_PATTERN, messageReplySchema } from "@heyloo/canonical-types";
import {
  Badge,
  Button,
  DataState,
  EmptyState,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  formatPhoneDisplay,
  PageHeader,
  Textarea,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, User } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import {
  describeOutboundMessage,
  isConversationTemplate,
  undeliveredReason,
} from "@/lib/messages/outbound-preview";
import { parseThreadKey, statusLabel } from "@/lib/messages/text-conversations";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

const replyFormSchema = z.object({ body: messageReplySchema.shape.body });
type ReplyFormValues = z.infer<typeof replyFormSchema>;

/** `system` = an automated notice (booking confirmation, cancellation, ...) rendered as a muted event, never as a chat bubble. */
type Author = "customer" | "ai" | "human" | "system";

interface ThreadMessage {
  id: string;
  author: Author;
  text: string;
  createdAt: string;
  /** Delivery caveat for an owner reply that did not go out ("not sent - ..."). */
  note?: string | null;
}

interface ThreadData {
  messages: ThreadMessage[];
  customerName: string | null;
  /** A `customers` row exists for this number in the tenant. */
  customerFound: boolean;
  smsOptOut: boolean;
  /** Present whenever `text_conversations` has a row for this thread
   * (BACKEND_SPEC.md §13.1) — every SMS conversation the text-agent engine
   * has touched, and every web-chat conversation (which has no
   * `messages_inbound`/`messages_outbound` row at all). `null` for a
   * legacy/engine-untouched SMS thread, which keeps showing the plain
   * inbound/outbound view with no authorship distinction — there is
   * nowhere to read one from in that case. */
  conversation: {
    id: string;
    channel: "sms" | "web_chat";
    status: "open" | "human" | "closed";
  } | null;
}

/**
 * `phone` here is really "thread key" — either a real E.164 number (every
 * SMS thread; unchanged from before this task, since other pages already
 * deep-link `/dashboard/messages/<phone>`) or a `wc:<conversation id>`
 * opaque key for a web-chat-only conversation with no phone at all
 * (`text-conversations.ts`'s `parseThreadKey`/`webChatKey`).
 */
export function MessageThreadClient({ tenantId, phone }: { tenantId: string; phone: string }) {
  const queryClient = useQueryClient();
  const threadKey = parseThreadKey(phone);
  // A phone thread whose URL segment is not an E.164 number ("/messages/abc")
  // has nothing to load and must never offer a composer (QA-1 F-22).
  const validThread = threadKey.kind === "web_chat" || E164_PATTERN.test(threadKey.phone);

  const query = useTenantQuery(
    tenantId,
    "messages_inbound",
    ["thread", phone],
    async (): Promise<ThreadData> => {
      // Resolve the text_conversations row for this thread, if any — by
      // phone+channel for an SMS thread, by id for a web-chat one.
      const conversationQuery =
        threadKey.kind === "phone"
          ? supabaseBrowserClient
              .from("text_conversations")
              .select("id, channel, status, customer_id")
              .eq("tenant_id", tenantId)
              .eq("phone_e164", threadKey.phone)
              .eq("channel", "sms")
              .maybeSingle()
          : supabaseBrowserClient
              .from("text_conversations")
              .select("id, channel, status, customer_id")
              .eq("tenant_id", tenantId)
              .eq("id", threadKey.conversationId)
              .maybeSingle();

      const [{ data: conversationRow }, customerByPhone] = await Promise.all([
        conversationQuery,
        threadKey.kind === "phone"
          ? supabaseBrowserClient
              .from("customers")
              .select("name, sms_opt_out")
              .eq("tenant_id", tenantId)
              .eq("phone_e164", threadKey.phone)
              .maybeSingle()
          : Promise.resolve({ data: null as { name: string | null; sms_opt_out: boolean } | null }),
      ]);

      let customerName = customerByPhone.data?.name ?? null;
      const customerFound = !!customerByPhone.data;
      const smsOptOut = customerByPhone.data?.sms_opt_out ?? false;

      if (conversationRow) {
        if (!customerName && conversationRow.customer_id) {
          const { data: c } = await supabaseBrowserClient
            .from("customers")
            .select("name")
            .eq("id", conversationRow.customer_id)
            .maybeSingle();
          customerName = c?.name ?? null;
        }

        const { data: transcript } = await supabaseBrowserClient
          .from("text_conversation_messages")
          .select("id, author, body, created_at")
          .eq("tenant_id", tenantId)
          .eq("conversation_id", conversationRow.id)
          .order("created_at", { ascending: true });

        return {
          customerName,
          customerFound,
          smsOptOut,
          conversation: {
            id: conversationRow.id,
            channel: conversationRow.channel,
            status: conversationRow.status,
          },
          messages: (transcript ?? []).map((m) => ({
            id: m.id,
            author: m.author,
            text: m.body,
            createdAt: m.created_at,
          })),
        };
      }

      // No text_conversations row — legacy plain SMS view (STOP/HELP-only
      // history, or a thread that predates the text-agent engine).
      if (threadKey.kind === "web_chat") {
        // A web-chat conversation ALWAYS has a text_conversations row (it's
        // the only place a web-chat turn is stored at all) — reaching here
        // means the id in the URL doesn't resolve to one, e.g. a stale
        // link. Surface as empty rather than guessing.
        return {
          customerName: null,
          customerFound: false,
          smsOptOut: false,
          conversation: null,
          messages: [],
        };
      }

      const [{ data: inbound }, { data: outbound }] = await Promise.all([
        supabaseBrowserClient
          .from("messages_inbound")
          .select("id, body, created_at")
          .eq("tenant_id", tenantId)
          .eq("from_e164", threadKey.phone)
          .order("created_at", { ascending: true }),
        supabaseBrowserClient
          .from("messages_outbound")
          .select("id, template_key, payload, status, created_at")
          .eq("tenant_id", tenantId)
          .eq("channel", "sms")
          .eq("recipient", threadKey.phone)
          .order("created_at", { ascending: true }),
      ]);

      const messages: ThreadMessage[] = [
        ...(inbound ?? []).map((m) => ({
          id: m.id,
          author: "customer" as const,
          text: m.body,
          createdAt: m.created_at,
        })),
        ...(outbound ?? []).map((m): ThreadMessage => {
          const { text } = describeOutboundMessage(
            m.template_key,
            (m.payload ?? {}) as Record<string, unknown>,
            m.status,
          );
          // Only real conversation content (an owner's typed reply, a caller's
          // taken message) is a chat bubble; the legacy view has no way to tell
          // an AI reply from a human one, so those stay "human". Automated
          // templates are muted system events whose wording reflects the real
          // delivery status (QA-1 F-03) — never a "YOU" bubble saying "sent"
          // for a message that failed or was never queued to a provider.
          if (isConversationTemplate(m.template_key)) {
            return {
              id: m.id,
              author: "human",
              text,
              createdAt: m.created_at,
              note: undeliveredReason(m.status),
            };
          }
          return { id: m.id, author: "system", text, createdAt: m.created_at };
        }),
      ].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

      return { messages, customerName, customerFound, smsOptOut, conversation: null };
    },
    // No broadcast trigger on messages_inbound/outbound yet
    // (docs/audit/FIX_REQUESTS.md); text_conversations/text_conversation_
    // messages DO broadcast (fn_broadcast_tenant_update), but polling
    // covers both uniformly without a second live-update code path here.
    { refetchInterval: 15000, enabled: validThread },
  );

  const form = useForm<ReplyFormValues>({
    resolver: zodResolver(replyFormSchema),
    defaultValues: { body: "" },
  });

  async function setConversationStatus(conversationId: string, status: "open" | "human") {
    const { error } = await supabaseBrowserClient
      .from("text_conversations")
      .update({ status })
      .eq("id", conversationId);
    if (error) {
      toast.error("Couldn't update — please try again.");
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: ["tenant", tenantId, "messages_inbound", "thread", phone],
    });
  }

  async function onSubmit(values: ReplyFormValues) {
    const conversation = query.data?.conversation;

    if (threadKey.kind === "phone") {
      // SMS delivery is the ONLY way a reply reaches an SMS customer, so it
      // goes first: a transcript row is written only once the send API has
      // accepted (queued) the message. Writing the row first left a phantom
      // "You" bubble behind — and a duplicate on retry — whenever the send
      // failed (QA-1 F-11).
      const res = await fetch(`/api/tenant/messages/${encodeURIComponent(threadKey.phone)}`, {
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
      if (conversation) {
        const { error } = await supabaseBrowserClient.from("text_conversation_messages").insert({
          tenant_id: tenantId,
          conversation_id: conversation.id,
          author: "human",
          body: values.body,
        });
        if (error) toast.error("Sent, but it couldn't be added to the transcript.");
        // The first owner reply pauses the AI for this thread (the engine only
        // stands down when status === 'human'); "Hand back to AI" reverses it.
        if (conversation.status === "open") {
          await supabaseBrowserClient
            .from("text_conversations")
            .update({ status: "human" })
            .eq("id", conversation.id);
        }
      } else {
        toast.success("Message queued");
      }
    } else if (conversation) {
      // Web chat has no live-push mechanism yet: the transcript row IS the reply.
      const { error } = await supabaseBrowserClient.from("text_conversation_messages").insert({
        tenant_id: tenantId,
        conversation_id: conversation.id,
        author: "human",
        body: values.body,
      });
      if (error) {
        toast.error("Couldn't send — please try again.");
        return;
      }
      toast.success("Saved — the visitor will see this the next time they message you.");
    }

    form.reset({ body: "" });
    void queryClient.invalidateQueries({
      queryKey: ["tenant", tenantId, "messages_inbound", "thread", phone],
    });
  }

  function authorBubbleClass(author: Author): string {
    if (author === "customer") return "bg-muted";
    if (author === "ai") return "bg-secondary text-secondary-foreground";
    return "bg-primary text-primary-foreground";
  }

  if (!validThread) {
    return (
      <EmptyState
        title="That isn't a valid phone number"
        description="Open a conversation from the Messages list or a customer's page."
      />
    );
  }

  return (
    // Height = viewport minus what the shell reserves around <main>: on phones
    // the 56px top bar, 16px top padding and the 80px bottom padding that
    // clears the fixed tab bar (9.5rem); from md up the tab bar is gone
    // (8rem). The old fixed 8rem left the composer under the tab bar (QA-1 F-25).
    <div className="flex h-[calc(100dvh-9.5rem)] flex-col gap-4 md:h-[calc(100dvh-8rem)]">
      <DataState
        query={query}
        empty={{
          title: "No messages with this number yet",
          // No conversation, no history and no matching customer: nothing to show
          // and nobody to reply to — no composer (QA-1 F-22).
          isEmpty: (d) => !d.conversation && d.messages.length === 0 && !d.customerFound,
        }}
        render={(data) => (
          <>
            <PageHeader
              title={
                data.customerName ??
                (threadKey.kind === "phone" ? formatPhoneDisplay(threadKey.phone) : "Web visitor")
              }
              description={
                data.customerName && threadKey.kind === "phone"
                  ? formatPhoneDisplay(threadKey.phone)
                  : undefined
              }
              actions={
                <div className="flex items-center gap-2">
                  {data.smsOptOut && <Badge variant="destructive">Opted out of texts</Badge>}
                  {data.conversation && (
                    <>
                      <Badge variant={data.conversation.status === "human" ? "warning" : "outline"}>
                        {statusLabel(data.conversation.status)}
                      </Badge>
                      {data.conversation.status !== "closed" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void setConversationStatus(
                              data.conversation?.id as string,
                              data.conversation?.status === "human" ? "open" : "human",
                            )
                          }
                        >
                          {data.conversation.status === "human" ? "Hand back to AI" : "Take over"}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              }
            />
            <div className="flex-1 space-y-2 overflow-y-auto rounded-md border border-border p-3">
              {data.messages.map((m) =>
                m.author === "system" ? (
                  <p
                    key={m.id}
                    data-testid="system-event"
                    className="text-center text-xs text-muted-foreground"
                  >
                    {m.text} · {new Date(m.createdAt).toLocaleString()}
                  </p>
                ) : (
                  <div
                    key={m.id}
                    className={m.author === "customer" ? "flex justify-start" : "flex justify-end"}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${authorBubbleClass(m.author)}`}
                    >
                      {m.author !== "customer" && (
                        <p className="mb-0.5 flex items-center gap-1 text-[11px] font-medium uppercase opacity-90">
                          {m.author === "ai" ? (
                            <>
                              <Bot className="size-3" /> AI
                            </>
                          ) : (
                            <>
                              <User className="size-3" /> You
                            </>
                          )}
                        </p>
                      )}
                      <p>{m.text}</p>
                      {m.note && <p className="mt-1 text-[11px] font-medium uppercase">{m.note}</p>}
                      <p className="mt-1 text-[11px] opacity-90">
                        {new Date(m.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ),
              )}
            </div>
            {data.smsOptOut && threadKey.kind === "phone" ? (
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
