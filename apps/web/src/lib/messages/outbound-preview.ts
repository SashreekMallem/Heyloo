/**
 * Delivery states of a `messages_outbound` row (`status` CHECK constraint in
 * 20260907130700_messaging.sql).
 */
export type OutboundStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "bounced"
  | "pending_verification";

/**
 * True only when the message actually left the building (`sent`/`delivered`).
 * `queued`, `pending_verification`, `failed` and `bounced` rows never reached
 * the customer, so the inbox/thread must not present them as sent (QA-1 F-03).
 */
export function isOutboundDelivered(status: string | null | undefined): boolean {
  return status === "sent" || status === "delivered";
}

/** Templates whose payload IS the conversation content (an owner's typed reply / a caller's message) — shown as real chat bubbles. */
export function isConversationTemplate(templateKey: string): boolean {
  return templateKey === "owner_reply" || templateKey === "take_message";
}

/** Short owner-facing explanation of why a row did not go out; `null` when it did (or the status is unknown). */
export function undeliveredReason(status: string | null | undefined): string | null {
  switch (status) {
    case "pending_verification":
      return "not sent - texting is pending verification";
    case "queued":
      return "queued - waiting to send";
    case "failed":
    case "bounced":
      return "not sent - delivery failed";
    default:
      return null;
  }
}

/**
 * Human-readable label for a `messages_outbound` row in the tenant-facing
 * thread view (MASTER_SPEC.md §3.3/§3.10). `messages_outbound` stores only
 * `template_key`/`payload` — the actual SMS text is rendered server-side at
 * send time (`supabase/functions/_shared/templates.ts`,
 * BACKEND_SPEC.md §10.2: "rendered server-side... not pre-rendered at
 * enqueue time"), so reproducing the exact customer-visible wording here
 * would mean duplicating that renderer client-side with no guard against
 * drift (the same maintenance-debt shape flagged for the template-compiler
 * duplication in docs/VERIFY.md). Instead: the cases where the payload
 * itself IS the real content — an owner's own typed reply (`owner_reply`,
 * this cluster's reply feature) and a caller's `take_message` (name +
 * message text + optional callback window, captured verbatim from the
 * voice-tools payload rather than a template needing separate wording) —
 * show the real content; everything else shows a neutral, honestly-labeled
 * system notice rather than a guessed transcript.
 *
 * `status` (optional; omitted = "assume it went out", the pre-QA-1
 * behaviour) makes the label honest: a system template that is still queued,
 * pending A2P verification or failed reads "Booking confirmation - not sent
 * (...)" instead of "Booking confirmation sent" (QA-1 F-03).
 */
export function describeOutboundMessage(
  templateKey: string,
  payload: Record<string, unknown>,
  status?: string | null,
): { text: string; isVerbatim: boolean } {
  if (templateKey === "owner_reply" && typeof payload["body"] === "string") {
    return { text: payload["body"], isVerbatim: true };
  }
  if (templateKey === "take_message") {
    const callerName =
      typeof payload["caller_name"] === "string" ? payload["caller_name"] : "A caller";
    const messageText = typeof payload["message_text"] === "string" ? payload["message_text"] : "";
    const callbackWindow =
      typeof payload["callback_window"] === "string" ? payload["callback_window"] : null;
    return {
      text: `${callerName} left a message: "${messageText}"${callbackWindow ? ` (callback: ${callbackWindow})` : ""}`,
      isVerbatim: true,
    };
  }
  const labels: Record<string, string> = {
    booking_confirmation: "Booking confirmation",
    booking_cancelled: "Cancellation notice",
    payment_link: "Payment link",
    reminder: "Appointment reminder",
    review_request: "Review request",
    order_confirmation: "Order confirmation",
    waitlist_slot_opened: "Waitlist opening notice",
    weekly_value_summary: "Weekly summary",
  };
  const reason = status === undefined ? null : undeliveredReason(status);
  if (templateKey === "a2p_pending_fallback" && !reason) {
    return {
      text: "Confirmation sent by email (SMS pending verification)",
      isVerbatim: false,
    };
  }
  const base =
    templateKey === "a2p_pending_fallback"
      ? "Email confirmation"
      : (labels[templateKey] ?? "System message");
  return { text: reason ? `${base} - ${reason}` : `${base} sent`, isVerbatim: false };
}
