import type { SqlClient } from "../_shared/types.js";

/**
 * `/webhooks-outreach` background processing (BACKEND_SPEC §7.5). Provider
 * payload (Smartlead/Instantly) is normalized to this canonical shape by
 * the Deno `index.ts` before reaching here — VERIFY.md: exact provider
 * field names per BACKEND_SPEC §7.5's own flag.
 */
export interface NormalizedOutreachEvent {
  campaign_external_id: string;
  lead_email_or_phone: string;
  event: "reply" | "open" | "click" | "bounce" | "complaint" | "unsubscribe";
  body?: string;
  occurred_at: string;
  provider_message_id?: string;
}

const COMPLAINT_AUTO_PAUSE_RATE = 0.003; // 0.3% — CAN-SPAM hard rule (SYSTEM_DESIGN §11)

export async function processOutreachEvent(
  sql: SqlClient,
  event: NormalizedOutreachEvent,
): Promise<void> {
  const campaignRows = await sql<{ id: string }>`
    select id from public.campaigns where id::text = ${event.campaign_external_id} limit 1
  `;
  const campaignId = campaignRows[0]?.id ?? null;

  if (event.provider_message_id) {
    await sql`
      update public.send_events
      set status = ${event.event === "reply" ? "sent" : event.event === "bounce" ? "bounced" : event.event === "complaint" ? "complained" : "sent"},
          opened_at = case when ${event.event} = 'open' then ${event.occurred_at}::timestamptz else opened_at end,
          clicked_at = case when ${event.event} = 'click' then ${event.occurred_at}::timestamptz else clicked_at end
      where provider_message_id = ${event.provider_message_id}
    `;
  }

  if (event.event === "reply") {
    const sendEventRows = event.provider_message_id
      ? await sql<{ id: string; lead_id: string }>`
          select id, lead_id from public.send_events where provider_message_id = ${event.provider_message_id} limit 1
        `
      : [];
    const sendEvent = sendEventRows[0];
    if (sendEvent) {
      await sql`
        insert into public.replies (send_event_id, lead_id, body, received_at)
        values (${sendEvent.id}, ${sendEvent.lead_id}, ${event.body ?? ""}, ${event.occurred_at}::timestamptz)
      `;
      // Claude intent classification runs fully async (a separate queue/job,
      // not this webhook's concern) — `replies.ai_intent` stays null until
      // that pass completes.
    }
    return;
  }

  if (event.event === "bounce" || event.event === "complaint" || event.event === "unsubscribe") {
    await sql`
      insert into public.suppression_list (contact, reason)
      values (${event.lead_email_or_phone}, ${event.event === "unsubscribe" ? "unsubscribe" : event.event})
      on conflict (contact) do nothing
    `;

    if (event.event === "complaint" && campaignId) {
      const rateRows = await sql<{ complaint_rate: number }>`
        with stats as (
          select
            count(*) filter (where status = 'complained') as complaints,
            count(*) as total
          from public.send_events where campaign_id = ${campaignId}
        )
        update public.campaigns c
        set complaint_rate = case when stats.total = 0 then 0 else stats.complaints::numeric / stats.total end
        from stats
        where c.id = ${campaignId}
        returning c.complaint_rate
      `;
      const rate = rateRows[0]?.complaint_rate ?? 0;
      if (rate >= COMPLAINT_AUTO_PAUSE_RATE) {
        await sql`update public.campaigns set status = 'paused' where id = ${campaignId}`;
      }
    }
  }
}
