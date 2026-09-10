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
 */
export function describeOutboundMessage(
  templateKey: string,
  payload: Record<string, unknown>,
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
    booking_confirmation: "Booking confirmation sent",
    booking_cancelled: "Cancellation notice sent",
    payment_link: "Payment link sent",
    reminder: "Appointment reminder sent",
    review_request: "Review request sent",
    order_confirmation: "Order confirmation sent",
    a2p_pending_fallback: "Confirmation sent by email (SMS pending verification)",
  };
  return { text: labels[templateKey] ?? "System message sent", isVerbatim: false };
}
