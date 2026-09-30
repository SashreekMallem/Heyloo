import type { ReplyData } from "@heyloo/ui/custom/reply-feed-item";

/**
 * Split out of `page.tsx` (a Next.js page file may only export a fixed
 * allow-list of names). `GET admin-outreach/replies` returns raw snake_case
 * rows joined to the lead; `ReplyFeedItem` takes `ReplyData` (COCKPIT-F09: the
 * page passed the raw rows straight through, so the lead name, intent and
 * actions were all undefined).
 */
export interface RawReply {
  id: string;
  body: string;
  ai_intent: ReplyData["intent"] | undefined;
  received_at: string;
  lead_id: string;
  company_name: string | null;
  contact_name: string | null;
  email: string | null;
  campaign_name: string | null;
}

export function toReplyData(raw: RawReply): ReplyData {
  const person = raw.contact_name ?? raw.company_name ?? raw.email ?? "Unknown lead";
  const org = raw.contact_name && raw.company_name ? ` · ${raw.company_name}` : "";
  return {
    id: raw.id,
    leadName: `${person}${org}`,
    body: raw.body,
    intent: raw.ai_intent ?? null,
    receivedAt: raw.received_at,
  };
}

export const SUCCESS_MESSAGE: Record<string, string> = {
  mark_interested: "Demo link sent",
  suppress: "Lead suppressed",
};

/** Human text for a failed action, by the handler's own status/error codes. */
export function failureMessage(status: number, body: unknown): string {
  const code = (body as { error?: unknown } | null)?.error;
  if (code === "lead_has_no_email") return "This lead has no email address to send to.";
  if (status === 501) return "Email sending isn't configured for this deployment.";
  if (status === 502) return "The email provider rejected the send. Nothing was changed.";
  if (status === 404) return "That reply no longer exists. Refresh the list.";
  return `Couldn't apply the action (HTTP ${status}). Please try again.`;
}
