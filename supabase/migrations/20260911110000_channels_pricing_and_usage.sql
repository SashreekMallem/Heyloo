-- Channels — price-card metering for the text agent + usage_daily rollup
-- (Cluster S build task, 2026-09-11). BACKEND_SPEC.md §13. Additive only.
--
-- DECIDE (this task's own resolution, CLAUDE.md Rule 4): metering unit is
-- **per outbound AI message**, not per conversation-day. A conversation can
-- run from a single reply to a long back-and-forth; billing by the day
-- would make one long thread free after its first message while a dozen
-- one-line "what are your hours" threads on the same day cost a dozen
-- units for near-zero AI work, and per-conversation-EVER (not per-day)
-- would let a single thread run forever for the price of one unit — both
-- are worse proxies for actual usage/cost than counting the thing that
-- actually costs money: each AI-generated reply (an LLM call, same cost
-- driver voice minutes are for cost_events.product = 'llm'). The
-- `included_text_conversations`/`text_conversation_overage_cents` KEY NAMES
-- (chosen to read naturally next to `included_minutes`/`overage_cents` on
-- the existing price-card shape) therefore count outbound AI MESSAGES
-- despite the "conversations" name — flagged here rather than renamed,
-- since BUILD_PLAN's own task line names these two keys verbatim.

alter table public.usage_daily
  add column text_messages_out int not null default 0;

comment on column public.usage_daily.text_messages_out is
  'Count of AI-generated text-agent replies (SMS + web_chat) sent this tenant this day — the billable unit for included_text_conversations/text_conversation_overage_cents (per-message, not per-conversation-day; see this migration''s header DECIDE note). Owned and incremented directly by _shared/text-agent/conversation-store.ts (one UPDATE per outbound AI message, not recomputed by fn_upsert_usage_daily below) — see that function''s own comment for why.';

-- fn_upsert_usage_daily: re-declared in full (CREATE OR REPLACE, not an
-- edit of the applied 20260907131400_functions_triggers.sql migration —
-- same convention 20260910110000_impersonation_claim.sql used to change
-- custom_access_token_hook). Originally (Cluster S) this also recomputed
-- text_messages_out from a `text_messages` table; that table was Cluster
-- S's own `text_conversations`/`text_messages` design, superseded by
-- Cluster T's text-agent engine (docs/audit/CHANNELS_REQUESTS.md item 1 —
-- see 20260911100000_channels_text_conversations.sql's updated header).
-- Cluster T's engine increments usage_daily.text_messages_out directly,
-- per-message, in the same transaction as saving the conversation turn
-- (_shared/text-agent/conversation-store.ts) — an event-sourced counter,
-- not a nightly rollup — so this function deliberately does NOT touch that
-- column at all: including it in the `on conflict do update set` clause
-- below (as Cluster S's original version did) would silently reset a
-- day's real-time-incremented count back to whatever this function
-- computed (0, since text_messages no longer exists), clobbering it every
-- time the cron rollup runs. Every other column here is unchanged from the
-- original.
create or replace function public.fn_upsert_usage_daily(p_tenant_id uuid, p_date date)
returns void language plpgsql as $$
declare
  v_price_version text;
begin
  select price_version into v_price_version from public.tenants where id = p_tenant_id;

  insert into public.usage_daily (
    tenant_id, date, total_calls, total_minutes, billable_minutes,
    total_bookings, total_orders, total_order_value_cents,
    price_version
  )
  select
    p_tenant_id, p_date,
    count(*) filter (where cl.started_at::date = p_date),
    coalesce(sum(cl.duration_seconds) filter (where cl.started_at::date = p_date), 0) / 60.0,
    coalesce(sum(ue.minutes) filter (where ue.is_billable and ue.occurred_at::date = p_date), 0),
    (select count(*) from public.bookings b where b.tenant_id = p_tenant_id and b.created_at::date = p_date),
    (select count(*) from public.orders o where o.tenant_id = p_tenant_id and o.created_at::date = p_date),
    (select coalesce(sum(o.total_cents), 0) from public.orders o where o.tenant_id = p_tenant_id and o.created_at::date = p_date),
    v_price_version
  from public.call_logs cl
  left join public.usage_events ue on ue.call_id = cl.id
  where cl.tenant_id = p_tenant_id
  on conflict (tenant_id, date) do update set
    total_calls = excluded.total_calls,
    total_minutes = excluded.total_minutes,
    billable_minutes = excluded.billable_minutes,
    total_bookings = excluded.total_bookings,
    total_orders = excluded.total_orders,
    total_order_value_cents = excluded.total_order_value_cents,
    updated_at = now();
end;
$$;

-- price_card_<vertical> platform_settings rows: merge in the two new keys
-- with a uniform sensible default (200 included outbound AI messages/month,
-- 5-cent overage per message beyond that — the exact figures BUILD_PLAN's
-- task line itself suggests as "e.g."). A jsonb `||` merge that only
-- touches rows lacking the key, so this is idempotent (safe to re-run) and,
-- crucially, a no-op rather than an error on a migrations-only environment
-- where supabase/seed/seed.sql (which is what actually INSERTs these eight
-- rows — no earlier migration does) hasn't run yet. See
-- docs/audit/CHANNELS_REQUESTS.md for the follow-up asking seed.sql's own
-- owner to carry these same two keys in its literal jsonb (seed.sql's own
-- `on conflict (key) do update set value = excluded.value` would otherwise
-- silently wipe this merge back out on the very next `supabase db reset`).
update public.platform_settings
set value = value || jsonb_build_object(
      'included_text_conversations', 200,
      'text_conversation_overage_cents', 5
    ),
    updated_at = now()
where key like 'price_card_%'
  and not (value ? 'included_text_conversations');
