-- SEC-2: lock authenticated-role writes to the columns the portal edits.
--
-- Problem (verified against the live grants + pg_policies, 2026-09-29):
-- Supabase's default privileges give `authenticated` table-wide
-- INSERT/UPDATE/DELETE on every public table, and the RLS policies on
-- tenants / agent_configs / referral_partners only check "which row" (tenant
-- or partner id) and role, never "which column". A tenant owner could
-- therefore PATCH their own row through PostgREST and change platform-managed
-- columns: tenants.status ('paused' escapes job-billing-cycle), plan_code,
-- price_version, stripe_customer_id / stripe_subscription_id, vertical,
-- is_test, referrer_partner_id, usage_hard_cap_minutes, deleted_at,
-- agent_configs.retell_agent_id / retell_llm_id / compiled_config /
-- greeting_overrides (the compiled-in AI + recording disclosure), and a
-- referral partner could raise their own rate_bps / commission_base /
-- duration_months or clear fraud_flags / w9_status / ytd_payout_cents.
--
-- Fix: column-level grants (deny by default, allow-list the columns each
-- portal write legitimately sets). RLS still decides WHICH rows; the grants
-- decide WHICH columns. A column added later is NOT writable by
-- `authenticated` until a migration grants it, which is the safe direction.
-- Everything privileged (edge functions, /api/admin/*, provisioning,
-- billing jobs) uses the secret-key `service_role`, which is unaffected.
--
-- Legit portal writes (enumerated from apps/web, SEC-2 audit; user-scoped
-- client only):
--   tenants        name, timezone, business_hours, hours_exceptions,
--                  language_config, owner_test_phone, manual_mode,
--                  manual_mode_enabled_at, voice_reminders_enabled,
--                  review_request_enabled, review_url,
--                  avg_transaction_value_cents, policies_reviewed_at,
--                  text_agent_enabled, text_agent_persona, quiet_hours,
--                  widget_enabled, widget_settings, widget_public_key,
--                  booking_min_notice_minutes, booking_horizon_days
--   agent_configs  assistant_name, special_instructions, transfer_number,
--                  dynamic_variable_overrides
--   referral_partners  paypal_email, payout_method, ftc_acknowledged_at,
--                  ftc_acknowledged_version
--   text_conversations status
--   memberships    last_seen_notifications_at (no writer yet; the intended
--                  "mark notifications read" write)
--   support_requests  none (tenants only INSERT tickets; staff triage via
--                  the service-role admin route)
--
-- New columns that a portal write needs MUST be added to the matching
-- grant list in a new migration (see docs/BUILD_NOTES.md, SEC-2).
--
-- Not touched (reviewed, see docs/BUILD_NOTES.md SEC-2): customers has
-- compliance columns (sms_opt_out, consent) but its segment/lifetime
-- triggers run as the invoking role, so narrowing it needs those triggers
-- made SECURITY DEFINER first; bookings/orders/offerings/resources/etc. hold
-- only tenant-owned data.

-- ---------------------------------------------------------------------
-- tenants: no INSERT / DELETE / TRUNCATE for browser roles (rows are created
-- by provisioning and soft-deleted by job-offboarding, both service_role);
-- UPDATE only on the owner-editable columns.
-- ---------------------------------------------------------------------
revoke insert, update, delete, truncate on public.tenants from authenticated, anon;
grant update (
  name, timezone, business_hours, hours_exceptions, language_config,
  owner_test_phone, manual_mode, manual_mode_enabled_at,
  voice_reminders_enabled, review_request_enabled, review_url,
  avg_transaction_value_cents, policies_reviewed_at,
  text_agent_enabled, text_agent_persona, quiet_hours,
  widget_enabled, widget_settings, widget_public_key,
  booking_min_notice_minutes, booking_horizon_days
) on public.tenants to authenticated;

-- ---------------------------------------------------------------------
-- agent_configs: row is created/published by the provisioning + publish
-- edge functions (service_role).
-- ---------------------------------------------------------------------
revoke insert, update, delete, truncate on public.agent_configs from authenticated, anon;
grant update (
  assistant_name, special_instructions, transfer_number, dynamic_variable_overrides
) on public.agent_configs to authenticated;

-- ---------------------------------------------------------------------
-- referral_partners: partner edits payout details + FTC acknowledgement only;
-- rates, W-9, payout totals and fraud flags are admin (service_role) data.
-- ---------------------------------------------------------------------
revoke insert, update, delete, truncate on public.referral_partners from authenticated, anon;
grant update (
  paypal_email, payout_method, ftc_acknowledged_at, ftc_acknowledged_version
) on public.referral_partners to authenticated;

-- ---------------------------------------------------------------------
-- memberships: the memberships_write policy lets an owner insert/update/
-- delete any membership row for their tenant, including for an arbitrary
-- user_id (which feeds custom_access_token_hook's tenant selection). No
-- portal code writes it with the user client (team listing/invites use the
-- service role), so only the notifications watermark stays writable.
-- ---------------------------------------------------------------------
revoke insert, update, delete, truncate on public.memberships from authenticated, anon;
grant update (last_seen_notifications_at) on public.memberships to authenticated;

-- ---------------------------------------------------------------------
-- text_conversations: members may flip a thread between AI and human
-- (`status`); verification state, counters, hashes and transcripts are
-- system-written.
-- ---------------------------------------------------------------------
revoke insert, update, delete, truncate on public.text_conversations from authenticated, anon;
grant update (status) on public.text_conversations to authenticated;

-- ---------------------------------------------------------------------
-- support_requests: tenants raise tickets (INSERT stays); status/priority
-- triage and edits are staff-only via the service-role admin route.
-- ---------------------------------------------------------------------
revoke update, delete, truncate on public.support_requests from authenticated, anon;
