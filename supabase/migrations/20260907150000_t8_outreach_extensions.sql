-- T8 outreach engine: schema gaps found while wiring the real Apollo/
-- Outscraper/Smartlead integrations against BACKEND_SPEC §1.8/§7.5/§7.7
-- (docs/BUILD_NOTES.md T8 entry — CLAUDE.md Rule 4: additive-only, no
-- existing column/constraint touched).
--
-- 1. `campaigns.external_campaign_id`: BACKEND_SPEC §1.8's `campaigns` DDL
--    has no column to hold the SENDER PLATFORM's own campaign id (Smartlead
--    assigns its own numeric id at `POST /campaigns/create` time) — without
--    it, `/webhooks-outreach` has no real way to map an inbound webhook's
--    `campaign_id` back to a local `campaigns` row (T3's original handler
--    worked around this by assuming the local uuid WAS the external id,
--    which is never true against a real Smartlead account). Nullable +ext
--    a partial unique index (only enforced once actually set) so an
--    unpublished draft campaign (no Smartlead campaign created yet) is
--    still a valid row.
-- 2. `leads.converted_tenant_id`: Flow 5 step 8 (API_AND_FLOWS.md) says
--    explicitly "leads.converted_tenant_id set, closing the loop into
--    cac_events/pipeline_costs vs revenue_events for the CAC dashboard" —
--    T1's `leads` DDL has a `status` enum value `'converted'` but no column
--    to record WHICH tenant a lead became. `cac_events.tenant_id` already
--    lets the channel-level CAC rollup (admin-cac, T4) work without this
--    column, but the outreach admin's own per-lead "convert" action
--    (BACKEND_SPEC §7.7 Outreach group, T8) needs somewhere to record it at
--    the lead level.
-- 3. Lookup indexes for the dedup path every lead-fetch/add-to-campaign
--    call makes against `suppression_list`/existing `leads` (BACKEND_SPEC
--    §1.8's own text: "deduped against suppression_list and existing
--    leads").
alter table public.campaigns
  add column external_campaign_id text;

create unique index idx_campaigns_provider_external_id
  on public.campaigns (provider, external_campaign_id)
  where external_campaign_id is not null;

alter table public.leads
  add column converted_tenant_id uuid references public.tenants(id);

create index idx_leads_email on public.leads (lower(email)) where email is not null;
create index idx_leads_phone on public.leads (phone) where phone is not null;
create index idx_leads_converted_tenant on public.leads (converted_tenant_id) where converted_tenant_id is not null;

comment on column public.campaigns.external_campaign_id is
  'Sender platform''s own campaign id (Smartlead numeric id today) — set once the campaign is actually created at the provider, T8.';
comment on column public.leads.converted_tenant_id is
  'Set by the outreach admin''s "convert" action once this lead signs up as a paying tenant (Flow 5 step 8) — closes the CAC loop alongside cac_events.tenant_id, T8.';
