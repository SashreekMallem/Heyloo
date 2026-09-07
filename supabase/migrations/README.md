# supabase/migrations/

Empty by design. The full data model (tenants, memberships, phone_numbers,
agent templates/configs, offerings/resources/availability_slots/bookings
with the GIST exclusion constraint, customers, call_logs, messages_outbound,
webhook_events, all money tables, referral tables, outreach tables,
admin_actions, platform_settings), RLS policies, the Custom Access Token
Hook, and seed/demo data land in **T1** — SYSTEM_DESIGN §6, §5 DDL.

Rules for every migration added from T1 onward (CLAUDE.md Rule 2):

- Filename: `YYYYMMDDHHMMSS_description.sql` (timestamped, ordered).
- Additive only — never edit a migration that has been applied. A fix is a
  new migration.
- Reproducible from zero: `supabase db reset` against an empty database
  must succeed end-to-end.
- RLS enabled on every table, tenant_id indexed and sourced from the JWT
  `app_metadata` claim only (never a request body/param).
- Money columns in integer cents or `numeric`; phone columns E.164;
  timestamps `timestamptz`.
