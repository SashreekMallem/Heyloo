-- SIGNUP-BILL-FIX: make Stripe-sourced billing rows idempotent.
--
-- Found by a real paid-signup run (Stripe test mode): nothing ever wrote
-- billing_invoices.stripe_invoice_id, so paid invoices never reached
-- billing_invoices and cockpit revenue stayed 0; the first charge's processing
-- fee was never recorded either. The webhook handler now UPSERTS from the
-- Stripe payload, which needs a unique key to conflict on.
--
-- Checked against the live database first (read-only): billing_invoices has 9
-- rows, all August drafts with stripe_invoice_id NULL; payment_processing_events
-- is empty. Nothing can violate the new indexes (NULLs are distinct).
--
-- 1. One billing_invoices row per Stripe invoice.
create unique index if not exists billing_invoices_stripe_invoice_id_key
  on public.billing_invoices (stripe_invoice_id);

-- 2. The old unique (tenant_id, period_start, period_end) was the billing-cycle
--    job's idempotency gate for its own calendar-month drafts. A Stripe invoice
--    period is anchored on the subscription date (e.g. 29 Sep - 29 Oct), and one
--    tenant can legitimately have several Stripe invoices with the same
--    period_start/period_end (a one-off invoice item is a zero-length period on
--    its creation day; a proration invoice repeats the cycle dates), so the
--    constraint would make the webhook fail. Narrow it to rows without a Stripe
--    invoice: the job's own rows stay unique per period, Stripe rows are unique
--    by stripe_invoice_id.
alter table public.billing_invoices
  drop constraint if exists billing_invoices_tenant_period_unique;
create unique index if not exists billing_invoices_local_period_key
  on public.billing_invoices (tenant_id, period_start, period_end)
  where stripe_invoice_id is null;

-- 3. One processing-fee row per Stripe charge (a replayed charge.succeeded event
--    must update, never double-count the fee).
create unique index if not exists payment_processing_events_stripe_charge_id_key
  on public.payment_processing_events (stripe_charge_id);

-- 4. Stripe events whose tenant/fee could not be resolved yet are kept in
--    webhook_events with processing_error 'deferred:<reason>' and replayed once
--    the tenant is linked (checkout.session.completed / invoice.paid). This
--    index makes that lookup cheap.
create index if not exists webhook_events_stripe_deferred_customer_idx
  on public.webhook_events ((payload -> 'data' -> 'object' ->> 'customer'))
  where source = 'stripe' and processing_error like 'deferred:%';
