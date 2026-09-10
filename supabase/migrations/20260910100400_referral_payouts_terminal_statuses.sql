-- Widen referral_payouts.status's CHECK constraint to include the two
-- terminal statuses webhooks-paypal/handler.ts advances a payout to on a
-- PAYMENT.PAYOUTS-ITEM.* webhook event (docs/audit/FIX_REQUESTS.md, cluster
-- F ask; E2E_FLOWS_AUDIT.md H2 — "Payout status never advances past
-- 'sent'"). Never edit 20260907130800_referrals.sql after it's applied
-- (CLAUDE.md Rule 2) — this drops + re-adds the column CHECK instead.
--
-- The original inline `check (status in ('pending','sent','failed'))`
-- column clause never named the constraint explicitly, so this looks up
-- Postgres's actual auto-generated name via pg_constraint at apply time
-- rather than hardcoding a guess (same caution as the adjacent
-- adapter_connections/adapter_sync_state provider-CHECK migration).

do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.referral_payouts'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%';
  if v_conname is not null then
    execute format('alter table public.referral_payouts drop constraint %I', v_conname);
  end if;
end;
$$;

alter table public.referral_payouts
  add constraint referral_payouts_status_check
  check (status in ('pending', 'sent', 'completed', 'failed', 'returned'));
