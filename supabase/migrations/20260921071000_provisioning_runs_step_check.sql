-- SIGNUP-1: `api-provision`'s number-provisioning step is now a single
-- `retell_number_provision` step (buys the number directly through Retell,
-- no Twilio account of our own required — docs/BUILD_NOTES.md SIGNUP-1
-- entry), replacing the old `twilio_number_provision` +
-- `retell_number_import` pair. Drop and recreate the CHECK constraint to
-- match `supabase/functions/api-provision/handler.ts`'s `STEPS`, or every
-- real saga run fails outright on its very first `provisioning_runs`
-- insert for this step (confirmed live: a real run hit exactly this
-- constraint violation before this migration).
alter table public.provisioning_runs drop constraint provisioning_runs_step_check;
alter table public.provisioning_runs add constraint provisioning_runs_step_check
  check (step in ('tenant_finalize','agent_compile','retell_number_provision',
                   'billing_wiring','publish_agent','notify'));
