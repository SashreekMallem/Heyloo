-- GAP_REGISTER.md §2 Motel items 4-5 — the exact nightly rate quoted from
-- the tenant's own {{rate_table}} (never model-invented,
-- RATE_DISCIPLINE_FRAGMENT in packages/templates/src/verticals/motel.ts)
-- had no column of its own to land in (only the untyped `structured_payload`
-- blob), so a rate dispute needed a transcript re-listen to resolve; and
-- "held scheduled until paid" (MASTER_SPEC §3.2) had no expiry-tracking
-- column at all, so a deposit-required booking could sit `scheduled`
-- forever with no TTL. Additive only (CLAUDE.md Rule 2).

alter table public.bookings
  add column if not exists quoted_rate_cents int,
  add column if not exists hold_expires_at timestamptz;

comment on column public.bookings.quoted_rate_cents is
  'Motel: the nightly rate actually quoted to the caller, mirrored from structured_payload.quoted_rate_cents onto a real column (GAP_REGISTER.md §2 Motel item 5) — null for every non-motel booking and for a motel booking where no rate was captured.';
comment on column public.bookings.hold_expires_at is
  'Set when create_booking inserts status=''scheduled'' for a tenant-required deposit hold (GAP_REGISTER.md §2 Motel item 4) — now() + the tenant''s configured deposit_policy.hold_window_hours (default 24h). fn_expire_unpaid_deposit_holds() (20260910122000_motel_deposit_hold_expiry_cron.sql) cancels the booking once this passes if still unpaid; webhooks-stripe/handler.ts flips the booking to ''confirmed'' on a paid deposit before this fires. Null for every booking that never held a deposit.';
