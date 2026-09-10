-- GAP_REGISTER.md §2 Motel item 4 — closes the double-booking hole left
-- open by 20260910122000_motel_deposit_hold_expiry_cron.sql's KNOWN
-- LIMITATION: a `scheduled` deposit hold (create_booking.ts, motel vertical
-- only, `hold_expires_at` set) did not block a second caller from being
-- offered or confirming the same resource/range for the entire hold
-- window, because both race-proofing mechanisms were scoped to
-- `status = 'confirmed'` only:
--   1. `public.bookings`' GIST exclusion constraint
--      (20260907130600_booking_core.sql:89-90).
--   2. `fn_invalidate_availability_on_booking()`
--      (20260907131400_functions_triggers.sql:305-320), which is what
--      `check_availability.ts` actually reads (`availability_slots.
--      is_available`).
--
-- Fix approach (b) from the gap's remediation note, not (a): a SECOND,
-- narrower exclusion constraint scoped to `hold_expires_at is not null and
-- status = 'scheduled'` rather than widening the existing constraint to
-- every `scheduled` row. Verified before choosing this: the only code path
-- anywhere in the repo that INSERTs `status = 'scheduled'` is
-- create_booking.ts's motel deposit-hold branch, which is also the only
-- path that ever sets `hold_expires_at`
-- (supabase/functions/voice-tools/tools/create_booking.ts,
-- supabase/functions/webhooks-twilio-sms/handler.ts's waitlist auto-book
-- and apps/web's dashboard booking-edit route both always insert/update to
-- `status = 'confirmed'` directly) — so this predicate matches exactly the
-- rows a deposit hold ever produces and leaves every other vertical's
-- (currently nonexistent) transient-`scheduled` usage untouched, per
-- CLAUDE.md Rule 2 "never edit an applied migration".
alter table public.bookings
  add constraint bookings_hold_exclusion
  exclude using gist (resource_id with =, during with &&)
  where (status = 'scheduled' and hold_expires_at is not null);

comment on constraint bookings_hold_exclusion on public.bookings is
  'Race-proofs the motel deposit-hold window: a second insert overlapping an unexpired scheduled+hold_expires_at booking for the same resource raises 23P01 (EXCLUSION_VIOLATION), which create_booking.ts already catches and turns into {confirmed:false, reason:"slot_taken"}. Confirmed bookings are still race-proofed by bookings_resource_id_during_excl (20260907130600_booking_core.sql).';

-- Extend the availability-invalidation trigger so a `scheduled` deposit
-- hold also flips `availability_slots.is_available = false` for its range
-- (check_availability.ts reads only `is_available`, so without this a held
-- room still showed as open for the whole hold window even after the
-- exclusion constraint above stops a second *write* from succeeding) — and
-- flips it back to `true` when the hold is released without ever being
-- paid (fn_expire_unpaid_deposit_holds() cancelling it, same as the
-- existing confirmed -> cancelled/no_show branch).
create or replace function public.fn_invalidate_availability_on_booking()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT' and (new.status = 'confirmed'
        or (new.status = 'scheduled' and new.hold_expires_at is not null)))
     or (tg_op = 'UPDATE' and new.status = 'confirmed'
         and old.status is distinct from 'confirmed')
     or (tg_op = 'UPDATE' and new.status = 'scheduled' and new.hold_expires_at is not null
         and (old.status is distinct from 'scheduled'
              or old.hold_expires_at is distinct from new.hold_expires_at)) then
    update public.availability_slots
    set is_available = false
    where resource_id = new.resource_id
      and slot_range && new.during;
  elsif (tg_op = 'UPDATE'
         and (old.status = 'confirmed'
              or (old.status = 'scheduled' and old.hold_expires_at is not null))
         and new.status in ('cancelled','no_show')) then
    update public.availability_slots
    set is_available = true
    where resource_id = new.resource_id
      and slot_range && new.during
      and source = 'generated';
  end if;
  return new;
end;
$$;
