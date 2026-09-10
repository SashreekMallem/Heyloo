-- Real-estate lead callback (GAP_REGISTER Cluster G item 2): a lead
-- submitted via a tenant's web form or CRM webhook, with an explicit TCPA
-- consent record (an AI/artificial voice call requires prior express
-- consent — SYSTEM_DESIGN §11), that api-lead-callback turns into an
-- outbound call. Deliberately its own table, NOT `public.leads`
-- (20260907130900_outreach.sql) — that table is cold-outreach-only and its
-- own column comment says its phone is "Never called by AI voice (TCPA)".

create table public.lead_callback_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text,
  phone_e164 text not null,
  source text not null default 'web_form' check (source in ('web_form', 'crm_webhook')),
  -- TCPA consent record: the exact checkbox text the lead saw + when +
  -- from where, never a bare boolean (MASTER_SPEC-style consent capture,
  -- matching customers.consent's own "never a literal boolean" convention
  -- elsewhere in this codebase).
  consent_text text not null,
  consent_given_at timestamptz not null,
  consent_ip text,
  status text not null default 'pending'
    check (status in ('pending', 'called', 'deferred_quiet_hours', 'refused_no_consent', 'failed')),
  refusal_reason text,
  provider_call_id text,
  call_log_id uuid references public.call_logs(id),
  scheduled_for timestamptz,
  -- CRM-webhook-supplied idempotency key (optional — a web-form submission
  -- has none) so a retried webhook delivery never places a second call for
  -- the same lead.
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_lead_callback_requests_tenant_status
  on public.lead_callback_requests (tenant_id, status);

create unique index lead_callback_requests_tenant_idempotency_key_unique
  on public.lead_callback_requests (tenant_id, idempotency_key)
  where idempotency_key is not null;

create trigger trg_lead_callback_requests_updated_at
  before update on public.lead_callback_requests
  for each row execute function public.fn_set_updated_at();

alter table public.lead_callback_requests enable row level security;

create policy lead_callback_requests_select on public.lead_callback_requests for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());
-- No client INSERT/UPDATE/DELETE policy: written only by
-- supabase/functions/api-lead-callback (service_role, tenant identified by
-- a validated api_tokens bearer token — see that function's own header)
-- and read via ordinary tenant-scoped SELECT (dashboard "leads" list, a
-- future Cluster H UI item), same posture as every other service-role-only
-- write table in this codebase (RLS enabled + zero matching write policy =
-- default deny).
