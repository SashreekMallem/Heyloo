-- T4 additions (Wave 2, docs/BUILD_NOTES.md T4 entry):
--   1. `tool_health` — BACKEND_SPEC §7.2's circuit-breaker telemetry table,
--      left as a documented gap by T3 (supabase/functions/_shared/
--      tool-stats.ts already emits into it, degrading gracefully when it's
--      absent; job-alert-evaluation's `tool_failure_spike` rule already
--      reads it). Shape follows tool-stats.ts's own docstring EXCEPT
--      `call_id`: that docstring assumed `uuid`, but the real hot-path value
--      passed in (`voice-tools/index.ts`'s `call_id`) is Retell's own
--      call-id string (`call_logs.retell_call_id`, `text` — see
--      20260907130500_call_logs.sql), not `call_logs.id`, and it may not
--      resolve to an existing call_logs row at all (an unresolved call
--      context still gets a stat recorded). Corrected to `text`, no FK.
--   2. `tenants` A2P 10DLC identifiers — BACKEND_SPEC §10.1 only specced the
--      `a2p_status` state machine (T1 added `tenants.a2p_status`); it never
--      named where the actual Twilio BrandRegistration/Campaign SIDs that
--      DRIVE that state machine should live. A new `api-a2p-register`
--      function (T4) needs somewhere to persist them per tenant.
create table public.tool_health (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id),
  tool_name text not null,
  call_id text,
  latency_ms int not null,
  success boolean not null,
  error_type text,
  occurred_at timestamptz not null default now()
);

create index idx_tool_health_tool_occurred on public.tool_health (tool_name, occurred_at desc);
create index idx_tool_health_tenant_occurred on public.tool_health (tenant_id, occurred_at desc);

comment on table public.tool_health is
  'Per-tool-call latency/success telemetry (BACKEND_SPEC §7.2/§8) emitted async from /voice-tools (tool-stats.ts) — never on the hot path''s return path. Feeds the cockpit bottleneck view and job-alert-evaluation''s tool_failure_spike rule.';

alter table public.tenants
  add column a2p_brand_sid text,
  add column a2p_campaign_sid text,
  add column a2p_messaging_service_sid text,
  add column a2p_failure_reason text;

comment on column public.tenants.a2p_brand_sid is
  'Twilio BrandRegistration SID (platform-level brand is shared across all tenants in Week-0 setup per API_AND_FLOWS.md A.2 — this column lets a tenant reference a per-tenant sub-brand if the reseller flow ever requires one; today every tenant is expected to carry the same shared platform brand SID).';
comment on column public.tenants.a2p_campaign_sid is
  'Twilio Campaign (UsAppToPerson) SID for this tenant''s Messaging Service — set once /api-a2p-register''s campaign-create call succeeds; drives a2p_status transitions via the campaign-status polling job.';
comment on column public.tenants.a2p_messaging_service_sid is
  'Twilio Messaging Service SID this tenant''s phone number(s) are attached to (A2P campaigns register against a Messaging Service, not a bare number).';
comment on column public.tenants.a2p_failure_reason is
  'Set when a2p_status transitions to ''failed'' (TCR rejection reason or Twilio error) — surfaced on the dashboard pending-verification banner per MASTER_SPEC §3.3/BACKEND_SPEC §10.1''s "never silently fail" requirement.';
