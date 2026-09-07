/**
 * Two-way SMS keyword classification (MASTER_SPEC §3.3 — new
 * `/webhooks-twilio-sms` function). Keyword sets match the CTIA/carrier
 * standard opt-out/opt-in/help vocabulary that Twilio itself documents as
 * the "advanced opt-out" default keyword list — VERIFY (docs/VERIFY.md):
 * confirm this exact list against Twilio's current Advanced Opt-Out docs
 * before go-live (egress-blocked in this environment); it is otherwise the
 * long-stable, widely-known set.
 */

const STOP_KEYWORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const START_KEYWORDS = new Set(["start", "yes", "unstop"]);
const HELP_KEYWORDS = new Set(["help", "info"]);

export type InboundSmsClassification = "stop" | "start" | "help" | "other";

export function classifyInboundSms(body: string | null | undefined): InboundSmsClassification {
  const normalized = (body ?? "").trim().toLowerCase();
  if (STOP_KEYWORDS.has(normalized)) return "stop";
  if (START_KEYWORDS.has(normalized)) return "start";
  if (HELP_KEYWORDS.has(normalized)) return "help";
  return "other";
}

/** Static, carrier-compliant reply bodies — never model-generated (this is
 * a legal/compliance surface, not a conversational one). */
export const SMS_STATIC_REPLIES = {
  stop: "You've been unsubscribed from messages from this business and won't receive more. Reply START to resubscribe.",
  start:
    "You're resubscribed to messages from this business. Reply HELP for help, STOP to unsubscribe.",
  help: "Heyloo AI assistant. For help, contact the business directly. Reply STOP to unsubscribe.",
} as const;
