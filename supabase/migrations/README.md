# supabase/migrations/

Full data model landed in **T1** (BACKEND_SPEC.md §0-§6, MASTER_SPEC.md §3
gap-patch-pack additions), split by domain in dependency order:

| File | Domain |
|---|---|
| `20260907130000_extensions_and_helpers.sql` | pgcrypto/btree_gist/pg_cron/pgmq/pg_net extensions, `fn_set_updated_at` |
| `20260907130100_tenancy.sql` | tenants, memberships, platform_admins, admin_actions |
| `20260907130200_telephony.sql` | phone_numbers |
| `20260907130300_agent_templates.sql` | agent_templates, agent_configs |
| `20260907130400_customers.sql` | customers, customer_addresses |
| `20260907130500_call_logs.sql` | call_logs (ordered ahead of booking_core — bookings.source_call_id FKs into it) |
| `20260907130600_booking_core.sql` | offerings, resources, availability_slots, bookings (GIST exclusion), orders, waitlist_entries |
| `20260907130700_messaging.sql` | messages_outbound, messages_inbound, webhook_events, payment_links |
| `20260907130800_referrals.sql` | referral_partners, referral_links, referrals, referral_payouts (ordered ahead of money — commission_events FKs into it) |
| `20260907130900_outreach.sql` | leads, campaigns, send_events, replies, suppression_list, pipeline_costs (ordered ahead of money — cac_events FKs into leads) |
| `20260907131000_money.sql` | cost_events, revenue_events, usage_events, usage_daily, billing_invoices, payment_processing_events, commission_events, cac_events, fixed_cost_allocations |
| `20260907131100_platform_support.sql` | platform_settings, support_requests, support_request_notes, api_tokens |
| `20260907131200_supporting_tables.sql` | demo_sessions, provisioning_runs, alerts, push_subscriptions, churn_scores, airtable_sync_state |
| `20260907131300_views.sql` | v_tenant_margin, v_call_cost_vs_billed, v_usage_alerts, v_referral_pnl |
| `20260907131400_functions_triggers.sql` | Custom Access Token Hook, availability regeneration (pre-subdivided per vertical), usage upsert, broadcast, invalidation, segment recompute, referral qualification, cost rollup, customer touch, waitlist notification |
| `20260907131500_rls.sql` | `fn_jwt_*` helpers, RLS enabled + policies on every table, `realtime.messages` tenant-channel policy |
| `20260907131600_storage.sql` | `recordings` bucket (private, signed-URL-only access) |

Deviations from the source specs' literal sketches (dependency reordering,
a subdivision-logic fill-in, and two real correctness bugs found by local
verification and fixed) are documented inline in the migration files
themselves and in `docs/BUILD_NOTES.md` (task T1).

Rules for every migration added from here on (CLAUDE.md Rule 2):

- Filename: `YYYYMMDDHHMMSS_description.sql` (timestamped, ordered).
- Additive only — never edit a migration that has been applied. A fix is a
  new migration.
- Reproducible from zero: `supabase db reset` against an empty database
  must succeed end-to-end.
- RLS enabled on every table, tenant_id sourced from the JWT `app_metadata`
  claim only (never a request body/param).
- Money columns in integer cents or `numeric`; phone columns E.164;
  timestamps `timestamptz`.

Queues (pgmq, BACKEND_SPEC §9) and scheduled jobs (pg_cron, BACKEND_SPEC
§8) are **not** created here — only their extensions. Actually creating
named queues/cron schedules is T3/T4's territory (edge functions +
lifecycle jobs consume them); T1's scope per BUILD_PLAN.md is §0-§6
(extensions, tables, views, functions/triggers, RLS, storage) only.
