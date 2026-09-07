/**
 * Server-side template rendering for `messages_outbound` (BACKEND_SPEC
 * §10.2: "All rendered server-side from `messages_outbound.payload` at send
 * time (not pre-rendered at enqueue time), so a template fix doesn't
 * require replaying already-queued messages"). Deliberately plain string
 * interpolation rather than a templating engine — these are short
 * transactional SMS/email bodies, not a rendering surface that benefits
 * from one, and it keeps the worker dependency-free.
 */

export type TemplateKey =
  | "booking_confirmation"
  | "booking_cancelled"
  | "after_hours_message"
  | "take_message"
  | "order_confirmation"
  | "payment_link"
  | "usage_alert_80"
  | "usage_alert_100"
  | "weekly_value_summary"
  | "support_ticket_update"
  | "a2p_pending_fallback"
  | "referral_payout_receipt"
  | "dunning_payment_failed"
  | "reminder"
  | "review_request";

export interface RenderedMessage {
  subject?: string;
  body: string;
}

export function renderTemplate(
  templateKey: string,
  payload: Record<string, unknown>,
): RenderedMessage {
  const str = (key: string, fallback = ""): string =>
    typeof payload[key] === "string" ? (payload[key] as string) : fallback;
  const num = (key: string): number | undefined =>
    typeof payload[key] === "number" ? (payload[key] as number) : undefined;

  switch (templateKey as TemplateKey) {
    case "booking_confirmation":
      return {
        body: `You're confirmed for ${str("start_local", "your appointment")}. Reply STOP to opt out.`,
      };
    case "booking_cancelled":
      return { body: "Your appointment has been cancelled. Call us if you'd like to rebook." };
    case "after_hours_message":
    case "take_message": {
      const callerName = str("caller_name", "A caller");
      const callerPhone = str("caller_phone");
      return { body: `${callerName} (${callerPhone}) left a message: "${str("message_text")}"` };
    }
    case "order_confirmation": {
      const total = num("total_cents");
      return {
        body: `Order received${total !== undefined ? ` — total $${(total / 100).toFixed(2)}` : ""}. Thanks!`,
      };
    }
    case "payment_link": {
      const total = num("amount_cents");
      return {
        body: `Please complete your payment${total !== undefined ? ` of $${(total / 100).toFixed(2)}` : ""}: ${str("url")}`,
      };
    }
    case "usage_alert_80":
      return {
        subject: "Usage alert: 80% of included minutes used",
        body: "Your account has used 80% of this month's included minutes.",
      };
    case "usage_alert_100":
      return {
        subject: "Usage alert: included minutes exhausted",
        body: "Your account has used 100% of this month's included minutes; overage rates now apply.",
      };
    case "weekly_value_summary":
      return {
        subject: "Your week with Heyloo",
        body: `This week: ${str("calls_answered", "0")} calls answered, ${str("bookings_captured", "0")} bookings captured.`,
      };
    case "support_ticket_update":
      return {
        subject: "Update on your support request",
        body: str("body", "Your support request has an update."),
      };
    case "a2p_pending_fallback":
      return {
        subject: "Message confirmation (email fallback)",
        body: str(
          "body",
          "SMS confirmations are pending carrier verification; sending by email in the meantime.",
        ),
      };
    case "referral_payout_receipt":
      return { subject: "Your referral payout", body: `Your payout has been sent.` };
    case "dunning_payment_failed":
      return {
        subject: "Payment failed",
        body: "We couldn't process your latest payment. Please update your billing details.",
      };
    case "reminder":
      return { body: `Reminder: you have an appointment ${str("start_local", "coming up")}.` };
    case "review_request":
      return { body: `Thanks for choosing us! Mind leaving a quick review? ${str("review_url")}` };
    default:
      return { body: "" };
  }
}
