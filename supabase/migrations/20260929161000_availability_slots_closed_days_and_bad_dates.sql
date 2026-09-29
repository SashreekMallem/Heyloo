-- VOICE-ALERTS-1 (docs/BUILD_NOTES.md; the "Left for the backend" list of
-- SETTINGS-1): the availability slot generator now respects closed days and
-- can no longer be aborted by one tenant's bad data.
--
-- Three live problems in fn_regenerate_availability_slots (last defined by
-- 20260910180000_motel_hold_regen_fix.sql):
--
--   1. A per-window `closed` flag was never read. The old portal saved a
--      closed day as `[{"open":"09:00","close":"17:00","closed":true}]`, and
--      the generator only iterated the day's array, so every "closed" day
--      still got bookable slots (live: SIGNUP-1 Test Auto's Sundays).
--      Both stored shapes are honored now: the canonical shape (a closed
--      day is `[]`, an exception is `{date, closed:true}` or
--      `{date, closed:false, hours:[...]}`) and the old per-window flag,
--      including on an exception's own `hours` and on a day stored as an
--      object (`{"closed":true}`).
--   2. `(e.value->>'date')::date` raised 22007 for a blank or malformed
--      exception date, aborting the resource's regeneration and, because
--      fn_cron_availability_rollforward() loops every resource in one
--      statement, the nightly rebuild for ALL tenants. Unparseable
--      exception entries are now skipped with a WARNING naming the tenant,
--      and the rollforward isolates each resource so any other per-tenant
--      failure (bad time zone, bad window time) skips that resource with a
--      WARNING instead of stopping the run.
--   3. tenants.booking_horizon_days (20260929140000_tenant_booking_rules.sql)
--      was never read. NULL keeps the vertical default (21 days, motel 30).
--
-- Also fixed while here: every rerun DUPLICATED today's already-started slots
-- (the delete only removed slots starting after now(), the loop re-inserted
-- everything from today), including a motel's current night. Reproduced on a
-- scratch Postgres: a second run took a motel resource from 31 to 32 slots
-- with one duplicated range. Now slots that have not ended are replaced and
-- slots that have ended are left alone and never re-inserted.
--
-- Also hardened while here (each one aborts or hangs the same loop):
--   - a `metadata.slot_minutes` that is not a positive integer (0 would
--     loop forever) falls back to the vertical default;
--   - a window whose open/close time cannot be parsed is skipped, not fatal;
--   - hours stored as something other than an object of arrays are treated
--     as "closed" instead of raising 22023 from jsonb_array_elements.
--
-- Motels (SETTINGS-1 notes): one whole-day slot per night, exactly as
-- before. Hours and exceptions do not apply to a motel and are not even
-- parsed for one, so a bad exception can never affect it.
--
-- Slots already generated keep their old shape until the next rebuild
-- (nightly 04:00 UTC, or an owner saving hours/resources). To apply this to
-- every tenant right away after deploying: select public.fn_cron_availability_rollforward();
--
-- Create-or-replace only; nothing is dropped, no data changes.

create or replace function public.fn_jsonb_is_true(p_value jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(p_value in ('true'::jsonb, '"true"'::jsonb), false)
$$;

comment on function public.fn_jsonb_is_true(jsonb) is
  'True for the JSON boolean true or the JSON string "true" (the two ways a `closed` flag has been stored in tenants.business_hours / hours_exceptions), false for anything else including NULL. Used by fn_regenerate_availability_slots.';

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
  v_horizon int;
  v_resource_meta jsonb;
  v_slot_minutes int;
  v_buffer_minutes int;
  v_days_ahead int;
  v_day date;
  v_day_key text;
  v_dow text;
  v_exc jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_entry_date date;
  v_entry_closed boolean;
  v_is_closed boolean;
  v_day_windows jsonb;
  v_weekly jsonb;
  v_window jsonb;
  v_window_open timestamptz;
  v_window_close timestamptz;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_slot_available boolean;
begin
  select t.timezone, t.vertical, t.business_hours, t.hours_exceptions, t.booking_horizon_days
    into v_tz, v_vertical, v_hours, v_exceptions, v_horizon
  from public.tenants t where t.id = p_tenant_id;

  -- An unusable time zone is a real failure of this tenant's configuration:
  -- raise before touching any slots (the caller's transaction, or the
  -- rollforward's per-resource block, then keeps the existing ones) rather
  -- than silently generating nothing.
  perform now() at time zone v_tz;

  select r.metadata, r.buffer_minutes into v_resource_meta, v_buffer_minutes
  from public.resources r where r.id = p_resource_id;
  v_buffer_minutes := coalesce(v_buffer_minutes, 0);

  -- A slot length must be a positive whole number of minutes; anything else
  -- (text, 0, negative) falls back to the vertical default. 0 would never
  -- advance the slot cursor below.
  v_slot_minutes := case
    when (v_resource_meta->>'slot_minutes') ~ '^[0-9]{1,5}$'
      and (v_resource_meta->>'slot_minutes')::int > 0
      then (v_resource_meta->>'slot_minutes')::int
    when v_vertical = 'motel' then 1440
    else 30
  end;
  v_days_ahead := least(
    greatest(
      coalesce(p_days_ahead, v_horizon, case when v_vertical = 'motel' then 30 else 21 end),
      1
    ),
    365
  );

  -- Clear only generated (non-manual-block) slots that have not ended yet
  -- for this resource before regenerating, so schedule-change edits are
  -- idempotent. This used to delete only slots STARTING at or after now(),
  -- while the loop below re-inserted every slot from today on: each rerun
  -- duplicated today's already-started slots, including a motel's current
  -- night (live check_availability could return the same night twice).
  -- Slots that have already ended are kept as history and never re-inserted.
  delete from public.availability_slots
  where resource_id = p_resource_id
    and source = 'generated'
    and upper(slot_range) > now();

  -- Normalize the exceptions once (not for a motel: hours do not apply to
  -- it). Each entry becomes {d: 'YYYY-MM-DD', closed: bool, hours: array|null};
  -- an entry whose date cannot be read is skipped and logged.
  if v_vertical <> 'motel' and jsonb_typeof(v_exceptions) = 'array' then
    for v_entry in select value from jsonb_array_elements(v_exceptions) loop
      begin
        if jsonb_typeof(v_entry) <> 'object' then
          raise exception 'entry is not an object';
        end if;
        v_entry_date := (v_entry->>'date')::date;
        if v_entry_date is null then
          raise exception 'entry has no date';
        end if;
        v_entry_closed := public.fn_jsonb_is_true(v_entry->'closed');
        v_exc := v_exc || jsonb_build_object(
          'd', to_char(v_entry_date, 'YYYY-MM-DD'),
          'closed', v_entry_closed,
          'hours', case when jsonb_typeof(v_entry->'hours') = 'array' then v_entry->'hours' else 'null'::jsonb end
        );
      exception when others then
        raise warning 'fn_regenerate_availability_slots: tenant %: skipping unreadable hours_exceptions entry % (%)',
          p_tenant_id, v_entry, sqlerrm;
      end;
    end loop;
  end if;

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
      if v_slot_end > now() then
        insert into public.availability_slots (tenant_id, resource_id, slot_range, source, is_available)
        values (
          p_tenant_id, p_resource_id,
          tstzrange(v_slot_start, v_slot_end, '[)'),
          'generated', v_slot_available
        );
      end if;
      continue;
    end if;

    v_day_key := to_char(v_day, 'YYYY-MM-DD');
    v_dow := lower(to_char(v_day, 'dy'));

    -- An exception for this date wins over the weekly hours: any entry
    -- marked closed closes the day; otherwise the first entry that carries
    -- its own `hours` replaces the weekly windows.
    select coalesce(bool_or((x->>'closed')::boolean), false),
           (array_agg(x->'hours') filter (
             where jsonb_typeof(x->'hours') = 'array' and not (x->>'closed')::boolean
           ))[1]
      into v_is_closed, v_day_windows
    from jsonb_array_elements(v_exc) x
    where x->>'d' = v_day_key;

    if v_is_closed then
      v_day_windows := '[]'::jsonb;
    elsif v_day_windows is null then
      -- Weekly hours. A day is normally an array of windows (closed = `[]`);
      -- also accepted: an object `{"closed":true}` (closed) or a single
      -- `{open, close}` window; anything else is closed.
      v_weekly := case when jsonb_typeof(v_hours) = 'object' then v_hours->v_dow end;
      v_day_windows := case
        when jsonb_typeof(v_weekly) = 'array' then v_weekly
        when jsonb_typeof(v_weekly) = 'object' and public.fn_jsonb_is_true(v_weekly->'closed')
          then '[]'::jsonb
        when jsonb_typeof(v_weekly) = 'object' and v_weekly ? 'open' and v_weekly ? 'close'
          then jsonb_build_array(v_weekly)
        else '[]'::jsonb
      end;
    end if;

    for v_window in select value from jsonb_array_elements(v_day_windows) loop
      -- The old portal stored a closed day as a window flagged closed; a
      -- non-object or unreadable window is skipped too, never fatal.
      continue when jsonb_typeof(v_window) <> 'object'
        or public.fn_jsonb_is_true(v_window->'closed');
      begin
        v_window_open := (v_day_key || ' ' || (v_window->>'open'))::timestamp at time zone v_tz;
        v_window_close := (v_day_key || ' ' || (v_window->>'close'))::timestamp at time zone v_tz;
      exception when others then
        raise warning 'fn_regenerate_availability_slots: tenant %: skipping unreadable window % on % (%)',
          p_tenant_id, v_window, v_day_key, sqlerrm;
        continue;
      end;
      v_slot_start := v_window_open;
      while v_slot_start + make_interval(mins => v_slot_minutes) <= v_window_close loop
        v_slot_end := v_slot_start + make_interval(mins => v_slot_minutes);
        -- Buffer-padded overlap check against this resource's existing
        -- confirmed bookings AND active (unexpired) deposit holds — same
        -- predicate as bookings_hold_exclusion /
        -- fn_invalidate_availability_on_booking()
        -- (20260910170000_motel_hold_exclusion.sql).
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
        if v_slot_end > now() then
          insert into public.availability_slots (tenant_id, resource_id, slot_range, source, is_available)
          values (
            p_tenant_id, p_resource_id,
            tstzrange(v_slot_start, v_slot_end, '[)'),
            'generated', v_slot_available
          );
        end if;
        v_slot_start := v_slot_start + make_interval(mins => v_slot_minutes);
      end loop;
    end loop;
  end loop;
end;
$$;

comment on function public.fn_regenerate_availability_slots(uuid, uuid, int) is
  'Precomputes availability_slots for a resource N days ahead (slots that have already ended are left alone, never re-inserted) (N = p_days_ahead, else tenants.booking_horizon_days, else 21 / motel 30; capped 1-365), deleting+reinserting future generated rows each call. Motel: one whole-night slot per day, hours/exceptions ignored. Others: per-window slot_minutes increments; a day is closed when its weekly array is empty, the window/object carries closed:true, or an hours_exceptions entry for the date is closed (an exception with hours replaces the weekly windows). Unreadable exception entries and windows are skipped with a WARNING, never fatal. A slot is unavailable if it overlaps (buffer-padded) a confirmed booking OR an active scheduled deposit hold (same predicate as bookings_hold_exclusion / fn_invalidate_availability_on_booking()).';

-- The nightly rebuild: one bad resource (invalid time zone, ...) is skipped
-- with a WARNING instead of aborting every other tenant's rebuild.
create or replace function public.fn_cron_availability_rollforward()
returns void language plpgsql as $$
declare
  r record;
begin
  for r in select tenant_id, id as resource_id from public.resources where active loop
    begin
      perform public.fn_regenerate_availability_slots(r.tenant_id, r.resource_id, null);
    exception when others then
      raise warning 'fn_cron_availability_rollforward: skipped resource % of tenant % (%)',
        r.resource_id, r.tenant_id, sqlerrm;
    end;
  end loop;
end;
$$;

comment on function public.fn_cron_availability_rollforward() is
  'Scheduled 04:00 UTC daily (BACKEND_SPEC §8 "Availability window roll-forward") — re-derives every active resource''s materialized availability window one day further out, keeping the rolling 14-30 day window full. A resource whose regeneration fails is skipped with a WARNING so it never stops the rest of the run (VOICE-ALERTS-1).';
