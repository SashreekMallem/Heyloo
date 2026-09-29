-- SETTINGS-1 (docs/BUILD_NOTES.md): owner-set booking-window rules. Before
-- this there was no column for either: the minimum notice is hardcoded in
-- voice-tools `check_availability` (30 min; 15 for restaurants) and the
-- booking horizon in `fn_regenerate_availability_slots` (21 days; 30 for
-- motels). The portal's Hours tab now writes these; NULL keeps the current
-- vertical default. Additive only — no reader is changed here: wiring
-- `check_availability` (min notice) and `fn_regenerate_availability_slots`
-- + `fn_cron_availability_rollforward` (horizon) is a backend follow-up
-- listed in the SETTINGS-1 notes, and the portal labels both fields
-- "not enforced yet" until then.

alter table public.tenants
  add column booking_min_notice_minutes integer,
  add column booking_horizon_days integer;

alter table public.tenants
  add constraint tenants_booking_min_notice_minutes_check
    check (booking_min_notice_minutes is null or booking_min_notice_minutes between 0 and 10080),
  add constraint tenants_booking_horizon_days_check
    check (booking_horizon_days is null or booking_horizon_days between 1 and 365);

comment on column public.tenants.booking_min_notice_minutes is
  'Owner-set minimum notice before a slot may be booked, in minutes (0-10080). NULL = vertical default (check_availability: 30, restaurant 15). Written by apps/web POST /api/tenant/settings/booking-rules.';
comment on column public.tenants.booking_horizon_days is
  'Owner-set booking horizon in days (1-365). NULL = vertical default (fn_regenerate_availability_slots: 21, motel 30). Written by apps/web POST /api/tenant/settings/booking-rules.';
