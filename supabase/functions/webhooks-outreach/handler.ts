import type { AnthropicFetch } from "../_shared/providers/anthropic.ts";
import { classifyReplyIntent } from "../_shared/providers/anthropic.ts";
import type { SmartleadFetch } from "../_shared/providers/smartlead.ts";
import { updateCampaignStatus } from "../_shared/providers/smartlead.ts";
import type { SqlClient } from "../_shared/types.ts";

/**
 * `/webhooks-outreach` background processing (BACKEND_SPEC §7.5). Provider
 * payload (Smartlead) is normalized to this canonical shape by the Deno
 * `index.ts` before reaching here — VERIFY.md: field names for
 * `EMAIL_REPLY`'s reply-body key specifically, and whether Smartlead
 * exposes a distinct spam-complaint event at all, remain flagged.
 */
export interface NormalizedOutreachEvent {
  campaign_external_id: string;
  lead_email_or_phone: string;
  event: "reply" | "open" | "click" | "bounce" | "complaint" | "unsubscribe";
  body?: string;
  occurred_at: string;
  provider_message_id?: string;
}

/** Optional — reply classification and the provider-side campaign pause
 * both degrade gracefully (skip, never throw) when unset, same convention
 * as every other optional-deps group in this codebase (`admin/handler.ts`'s
 * `AdminDeps`). */
export interface OutreachEventDeps {
  anthropic?: { fetchImpl: AnthropicFetch; apiKey: string; model: string };
  smartlead?: { fetchImpl: SmartleadFetch; apiKey: string };
}

const COMPLAINT_AUTO_PAUSE_RATE = 0.003; // 0.3% — CAN-SPAM hard rule (SYSTEM_DESIGN §11)

export async function processOutreachEvent(
  sql: SqlClient,
  event: NormalizedOutreachEvent,
  deps: OutreachEventDeps = {},
): Promise<void> {
  const campaignRows = await sql<{
    id: string;
    provider: string;
    external_campaign_id: string | null;
  }>`
    select id, provider, external_campaign_id from public.campaigns
    where external_campaign_id = ${event.campaign_external_id} or id::text = ${event.campaign_external_id}
    limit 1
  `;
  const campaign = campaignRows[0] ?? null;
  const campaignId = campaign?.id ?? null;

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
      const insertedReply = await sql<{ id: string }>`
        insert into public.replies (send_event_id, lead_id, body, received_at)
        values (${sendEvent.id}, ${sendEvent.lead_id}, ${event.body ?? ""}, ${event.occurred_at}::timestamptz)
        returning id
      `;
      const replyId = insertedReply[0]?.id;

      // Sync haiku classification (BACKEND_SPEC §1.8/§7.5) — a failed/
      // unset classification leaves `ai_intent` null and the reply
      // surfaces in an "unclassified" admin queue rather than guessing
      // (API_AND_FLOWS.md A.5's documented failure-handling rule).
      if (replyId && deps.anthropic) {
        const intent = await classifyReplyIntent(
          deps.anthropic.fetchImpl,
          deps.anthropic.apiKey,
          deps.anthropic.model,
          event.body ?? "",
        );
        if (intent) {
          await sql`update public.replies set ai_intent = ${intent} where id = ${replyId}`;
        }
      }

      await sql`
        update public.leads set status = 'replied'
        where id = ${sendEvent.lead_id} and status not in ('suppressed', 'converted')
      `;
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
        // Back the local flag with a real stop-sending call at the sender
        // platform — never a local-DB-only pause (CAN-SPAM hard rule).
        if (deps.smartlead && campaign?.provider === "smartlead" && campaign.external_campaign_id) {
          await updateCampaignStatus(
            deps.smartlead.fetchImpl,
            deps.smartlead.apiKey,
            campaign.external_campaign_id,
            "PAUSED",
          );
        }
      }
    }
  }
}
