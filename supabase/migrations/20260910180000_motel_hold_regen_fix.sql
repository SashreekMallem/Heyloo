-- GAP_REGISTER.md §2 Motel item 4 follow-up (WAVE-2 integration pass) —
-- 20260910170000_motel_hold_exclusion.sql closed the double-booking hole in
-- two of the three places `status = 'scheduled' and hold_expires_at is not
-- null` (a motel deposit hold) needed to be treated the same as
-- `status = 'confirmed'`: the GIST exclusion constraint (new,
-- `bookings_hold_exclusion`) and `fn_invalidate_availability_on_booking()`
-- (create-or-replaced there). It did NOT touch the third:
-- `fn_regenerate_availability_slots()` (20260909120000_live_mining_hardening.sql:41-165),
-- which DELETEs every future `generated` availability_slots row for a
-- resource and reinserts them, deciding each new slot's `is_available` by
-- checking only `b.status = 'confirmed'` bookings. Any resource regenerated
-- while an active, unexpired deposit hold exists (the nightly roll-forward
-- job — job-availability-roll-forward — or a tenant editing business hours
-- mid-hold) would silently re-open that held room: `is_available` flips
-- back to `true` for the hold's date range even though
-- `bookings_hold_exclusion` still blocks the actual booking INSERT, so a
-- second caller could be told the room is free by check_availability.ts
-- (which reads only `is_available`) and only discover the conflict at
-- create_booking.ts's insert, or worse — since `fn_regenerate_availability_slots`
-- only DELETEs+reinserts today's-and-future `generated` slots, a caller
-- quoted a phantom-open night would hit a confusing "slot_taken" after
-- being told it was available.
--
-- Fix: create-or-replace this function so its motel per-night overlap
-- check uses the exact same predicate as `bookings_hold_exclusion` and
-- `fn_invalidate_availability_on_booking()` (20260910170000_motel_hold_exclusion.sql)
-- instead of `b.status = 'confirmed'` alone. The generic (non-motel)
-- per-window slot loop gets the identical predicate for consistency, even
-- though no non-motel code path currently inserts `status = 'scheduled'`
-- with `hold_expires_at` set (per that migration's own verification note)
-- — this keeps the three race-proofing mechanisms provably identical
-- rather than motel-only-by-coincidence. Never edit the two prior
-- migrations that already touched this function/table (CLAUDE.md Rule 2);
-- this is a fresh `create or replace` on top of them.
create or replace function public.fn_regenerate_availability_slots(
  p_tenant_id uuid,
  p_resource_id uuid,
  p_days_ahead int default null
) returns void
language plpgsql as $$
declare
  v_tz text;
  v_vertical text;
  v_hours jsonb;
  v_exceptions jsonb;
  v_resource_meta jsonb;
  v_slot_minutes int;
  v_buffer_minutes int;
  v_days_ahead int;
  v_day date;
  v_dow text;
  v_is_closed boolean;
  v_day_windows jsonb;
  v_window jsonb;
  v_window_open timestamptz;
  v_window_close timestamptz;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_slot_available boolean;
begin
  select t.timezone, t.vertical, t.business_hours, t.hours_exceptions
    into v_tz, v_vertical, v_hours, v_exceptions
  from public.tenants t where t.id = p_tenant_id;

  select r.metadata, r.buffer_minutes into v_resource_meta, v_buffer_minutes
  from public.resources r where r.id = p_resource_id;
  v_buffer_minutes := coalesce(v_buffer_minutes, 0);

  v_slot_minutes := coalesce(
    nullif(v_resource_meta->>'slot_minutes', '')::int,
    case when v_vertical = 'motel' then 1440 else 30 end
  );
  v_days_ahead := coalesce(p_days_ahead, case when v_vertical = 'motel' then 30 else 21 end);

  -- Clear only future generated (non-manual-block) slots for this resource
  -- before regenerating, so schedule-change edits are idempotent.
  delete from public.availability_slots
  where resource_id = p_resource_id
    and source = 'generated'
    and lower(slot_range) >= now();

  for v_day in select generate_series(current_date, current_date + v_days_ahead, '1 day')::date loop

    if v_vertical = 'motel' then
      -- Per-night: one slot spanning the full calendar day.
      v_slot_start := v_day::timestamp at time zone v_tz;
      v_slot_end := (v_day + 1)::timestamp at time zone v_tz;
      v_slot_available := not exists (
        select 1 from public.bookings b
        where b.resource_id = p_resource_id
          and (b.status = 'confirmed'
               or (b.status = 'scheduled' and b.hold_expires_at is not null))
          and b.during && tstzrange(
            v_slot_start - make_interval(mins => v_buffer_minutes),
            v_slot_end + make_interval(mins => v_buffer_minutes),
            '[)'
          )
      );
      insert into public.availability_slots (tenant_id, resource_id, slot_range, source, is_available)
      values (
        p_tenant_id, p_resource_id,
        tstzrange(v_slot_start, v_slot_end, '[)'),
        'generated', v_slot_available
      );
      continue;
    end if;

    v_dow := lower(to_char(v_day, 'dy'));

    select coalesce((e.value->>'closed')::boolean, false)
      into v_is_closed
    from jsonb_array_elements(v_exceptions) e(value)
    where (e.value->>'date')::date = v_day;

    if coalesce(v_is_closed, false) then
      v_day_windows := '[]'::jsonb;
    else
      select e.value->'hours'
        into v_day_windows
      from jsonb_array_elements(v_exceptions) e(value)
      where (e.value->>'date')::date = v_day and e.value ? 'hours';

      if v_day_windows is null then
        v_day_windows := coalesce(v_hours->v_dow, '[]'::jsonb);
      end if;
    end if;

    for v_window in select jsonb_array_elements(v_day_windows) loop
      v_window_open := (v_day || ' ' || (v_window->>'open'))::timestamp at time zone v_tz;
      v_window_close := (v_day || ' ' || (v_window->>'close'))::timestamp at time zone v_tz;
      v_slot_start := v_window_open;
      while v_slot_start + make_interval(mins => v_slot_minutes) <= v_window_close loop
        v_slot_end := v_slot_start + make_interval(mins => v_slot_minutes);
        -- Buffer-padded overlap check against this resource's existing
        -- confirmed bookings AND active (unexpired) deposit holds — legacy's
        -- get_available_slots() did the confirmed-only check at request
        -- time; here it's baked in at precompute time (BACKEND_SPEC's
        -- stated "zero runtime arithmetic on the hot path" goal for this
        -- function), now matching bookings_hold_exclusion /
        -- fn_invalidate_availability_on_booking() (20260910170000_motel_hold_exclusion.sql).
        v_slot_available := not exists (
          select 1 from public.bookings b
          where b.resource_id = p_resource_id
            and (b.status = 'confirmed'
                 or (b.status = 'scheduled' and b.hold_expires_at is not null))
            and b.during && tstzrange(
              v_slot_start - make_interval(mins => v_buffer_minutes),
              v_slot_end + make_interval(mins => v_buffer_minutes),
              '[)'
            )
        );
        insert into public.availability_slots (tenant_id, resource_id, slot_range, source, is_available)
        values (
          p_tenant_id, p_resource_id,
          tstzrange(v_slot_start, v_slot_end, '[)'),
          'generated', v_slot_available
        );
        v_slot_start := v_slot_start + make_interval(mins => v_slot_minutes);
      end loop;
    end loop;
  end loop;
end;
$$;

comment on function public.fn_regenerate_availability_slots(uuid, uuid, int) is
  'Precomputes availability_slots for a resource N days ahead (motel: per-night, others: per-window slot_minutes increments), deleting+reinserting future generated rows each call. A slot is unavailable if it overlaps (buffer-padded) a confirmed booking OR an active scheduled deposit hold (status=''scheduled'' with hold_expires_at set) — kept identical to bookings_hold_exclusion and fn_invalidate_availability_on_booking()''s predicate (20260910170000_motel_hold_exclusion.sql) so a roll-forward regen never re-opens a room a caller already has on hold. GAP_REGISTER.md §2 Motel item 4 follow-up.';
