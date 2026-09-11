/**
 * Small shared helpers for reading `text_conversations`/
 * `text_conversation_messages` (Cluster T's text-agent engine,
 * `20260911120000_text_conversations.sql`/
 * `20260911130000_text_conversation_messages.sql`) from the dashboard's
 * Messages feature — used by both `messages-list-client.tsx` and
 * `[phone]/message-thread-client.tsx`.
 */

/** A web-chat conversation has no phone number (BACKEND_SPEC.md §13.1's
 * identity rule: unverified until the visitor confirms one), so it can't
 * use the existing `/dashboard/messages/[phone]` route's param as a real
 * phone the way every SMS thread does. Every other page that deep-links
 * into a specific thread (`customer-detail-client.tsx`, `order-detail-
 * client.tsx`, `bookings/page.tsx`) always has a real phone and must keep
 * working unmodified, so the route itself isn't renamed — a web-chat
 * thread instead reuses the same `[phone]` slot with this opaque
 * `wc:<conversation id>` value, which `message-thread-client.tsx` detects
 * via `parseThreadKey` before treating it as a phone number anywhere
 * (never passed to `formatPhoneDisplay`/an `.eq("phone_e164", …)` filter). */
const WEB_CHAT_PREFIX = "wc:";

export function webChatKey(conversationId: string): string {
  return `${WEB_CHAT_PREFIX}${conversationId}`;
}

export type ThreadKey =
  | { kind: "phone"; phone: string }
  | { kind: "web_chat"; conversationId: string };

export function parseThreadKey(raw: string): ThreadKey {
  if (raw.startsWith(WEB_CHAT_PREFIX)) {
    return { kind: "web_chat", conversationId: raw.slice(WEB_CHAT_PREFIX.length) };
  }
  return { kind: "phone", phone: raw };
}

export function statusLabel(status: "open" | "human" | "closed"): string {
  switch (status) {
    case "open":
      return "AI is replying";
    case "human":
      return "You're replying";
    case "closed":
      return "Closed";
  }
}
