-- FIX_REQUESTS.md: a real "reviewed" signal for the dashboard's
-- setup-progress panel's "Review your cancellation & booking policy" step,
-- which previously had to proxy off `agent_configs.dynamic_variable_
-- overrides.cancellation_policy.text` being non-empty (real, but conflates
-- "configured" with "reviewed"). Additive only.

alter table public.tenants
  add column policies_reviewed_at timestamptz;

comment on column public.tenants.policies_reviewed_at is
  'Set the moment a tenant owner/admin saves the vertical-details Settings form with a non-empty cancellation_policy.text (apps/web api/tenant/agent/vertical-details route) — an explicit, timestamped acknowledgment rather than an inferred proxy. NULL = never reviewed/saved.';

-- One-time backfill: a tenant that already has a configured
-- cancellation_policy.text as of this migration gets a value here too
-- (this migration's own apply time), so the setup-progress panel's step
-- doesn't regress from "done" to "not done" for every tenant that
-- configured a policy before this column existed.
update public.tenants t
set policies_reviewed_at = now()
from public.agent_configs ac
where ac.tenant_id = t.id
  and t.policies_reviewed_at is null
  and coalesce(ac.dynamic_variable_overrides -> 'cancellation_policy' ->> 'text', '') <> '';
