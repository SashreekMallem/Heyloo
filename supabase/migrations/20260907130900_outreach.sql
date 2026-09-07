-- Outreach engine. BACKEND_SPEC.md §1.8.
-- Ordered before the money domain because cac_events.lead_id FKs into
-- leads defined here.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('apollo','outscraper','apify','license_roll')),
  vertical text,
  company_name text,
  contact_name text,
  email text,
  phone text,
  enrichment jsonb not null default '{}'::jsonb,
  status text not null default 'new'
    check (status in ('new','queued','sent','replied','suppressed','converted')),
  created_at timestamptz not null default now()
);

comment on column public.leads.phone is
  'Never called by AI voice (TCPA, SYSTEM_DESIGN §11) — outreach is email-only.';

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vertical text,
  sender_domain text not null,
  provider text not null check (provider in ('smartlead','instantly')),
  status text not null default 'draft' check (status in ('draft','warming','active','paused')),
  complaint_rate numeric,
  created_at timestamptz not null default now()
);

create table public.send_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  lead_id uuid not null references public.leads(id),
  step_index int not null,
  provider_message_id text,
  sent_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  status text not null default 'queued' check (status in ('queued','sent','bounced','complained'))
);

create index idx_send_events_campaign on public.send_events (campaign_id);
create index idx_send_events_lead on public.send_events (lead_id);

create table public.replies (
  id uuid primary key default gen_random_uuid(),
  send_event_id uuid references public.send_events(id),
  lead_id uuid not null references public.leads(id),
  body text not null,
  ai_intent text check (ai_intent is null or ai_intent in ('interested','not_interested','unsubscribe','question','auto_reply')),
  received_at timestamptz not null default now()
);

create table public.suppression_list (
  id uuid primary key default gen_random_uuid(),
  contact text not null,
  reason text not null check (reason in ('unsubscribe','bounce','complaint','manual')),
  created_at timestamptz not null default now(),
  constraint suppression_list_contact_unique unique (contact)
);

create table public.pipeline_costs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id),
  category text not null check (category in ('list_cost','ai_personalization','sender_fee','domain_warmup')),
  amount_cents int not null,
  occurred_at timestamptz not null
);
