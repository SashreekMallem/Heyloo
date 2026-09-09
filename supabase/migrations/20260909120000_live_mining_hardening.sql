-- Live-legacy-mining hardening pass (task LIVE-MINE-FIXES).
-- Additive only — see docs/BUILD_NOTES.md (LIVE-MINE-DB) and
-- docs/LEGACY_LIVE_FINDINGS.md § Database for the full findings this
-- migration acts on. Three independent fixes, each reproducible from zero:
--
--   (a) booking buffer/turnaround time (Finding 4 — ADOPT)
--   (b) E.164 format CHECK constraints, defense-in-depth (Finding 5 — ADOPT)
--   (c) exclusion-constraint predicate tripwire (Finding 3 — comment only,
--       no behavior change yet; see the COMMENT ON CONSTRAINT below)

-- ===========================================================================
-- (a) Booking buffer / turnaround time
-- ===========================================================================
-- Legacy's live get_available_slots() padded every candidate slot by a
-- p_buffer_minutes gap (default 15) against existing appointments — real
-- vertical need (chair/room/bay cleanup, turnaround time) the original
-- schema had no equivalent for. Landed as a real column (not a
-- resources.metadata JSON key, unlike slot_minutes) per this task's
-- explicit instruction, on `resources` — the same table slot_minutes'
-- override already lives on, so both knobs are discoverable together.

alter table public.resources
  add column buffer_minutes int not null default 0;

comment on column public.resources.buffer_minutes is
  'Turnaround/cleanup gap (minutes) fn_regenerate_availability_slots pads around this resource''s existing confirmed bookings when deciding which precomputed availability_slots rows to mark available — e.g. dental chair or auto bay reset time. 0 (default) preserves the original no-gap behavior. Landed as a real column rather than resources.metadata, unlike slot_minutes, per docs/BUILD_NOTES.md (LIVE-MINE-DB item 1) / docs/LEGACY_LIVE_FINDINGS.md Finding 4.';

-- fn_regenerate_availability_slots (create or replace): identical shape to
-- the 20260907131400_functions_triggers.sql original, with buffer_minutes
-- now honored. Since this function always DELETEs every future 'generated'
-- row for the resource before reinserting (see below), honoring the buffer
-- here also means checking each newly-generated slot's availability against
-- the resource's EXISTING confirmed bookings (previously this function
-- always inserted every generated slot as is_available = true regardless of
-- already-confirmed bookings, relying entirely on
-- fn_invalidate_availability_on_booking to flip a slot back to unavailable
-- after the fact — a gap only exposed once a resource with existing
-- confirmed bookings gets its slots regenerated, e.g. the nightly
-- roll-forward job or a business-hours edit). Bookings themselves are never
-- touched by this function, only availability_slots.
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
          and b.status = 'confirmed'
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
        -- confirmed bookings — legacy's get_available_slots() did the
        -- identical check at request time; here it's baked in at precompute
        -- time (BACKEND_SPEC's stated "zero runtime arithmetic on the hot
        -- path" goal for this function).
        v_slot_available := not exists (
          select 1 from public.bookings b
          where b.resource_id = p_resource_id
            and b.status = 'confirmed'
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

-- ===========================================================================
-- (b) E.164 format CHECK constraints (defense-in-depth)
-- ===========================================================================
-- Neither the legacy live DB nor this schema enforced phone-number shape at
-- the database boundary — normalization was entirely an application-layer
-- (Zod) concern. CLAUDE.md Rule 2 already commits to E.164-everywhere as an
-- architecture invariant; these CHECKs make it fail loudly at insert time
-- too, independent of the app layer. Tables are empty in every real
-- deployment of this migration (pre-launch), so no NOT VALID / VALIDATE
-- CONSTRAINT two-step is needed — plain CHECKs are validated immediately
-- and safely here. Verified against supabase/seed/seed.sql: no seed row
-- inserts into any of these four columns, so nothing to fix there.

alter table public.phone_numbers
  add constraint phone_numbers_e164_format_chk
  check (e164 ~ '^\+[1-9]\d{1,14}$');

alter table public.customers
  add constraint customers_phone_e164_format_chk
  check (phone_e164 ~ '^\+[1-9]\d{1,14}$');

alter table public.messages_inbound
  add constraint messages_inbound_from_e164_format_chk
  check (from_e164 ~ '^\+[1-9]\d{1,14}$');

alter table public.messages_inbound
  add constraint messages_inbound_to_e164_format_chk
  check (to_e164 ~ '^\+[1-9]\d{1,14}$');

-- ===========================================================================
-- (c) Exclusion-constraint predicate tripwire (Finding 3 — comment only)
-- ===========================================================================
-- Legacy's live booking exclusion constraint blocked overlap for every
-- status except 'cancelled'; this schema's blocks overlap only for
-- status = 'confirmed' (bookings_resource_id_during_excl, auto-named by
-- Postgres from the unnamed `exclude` clause in
-- 20260907130600_booking_core.sql). Safe today because create_booking
-- (BACKEND_SPEC §7.2.2) only ever writes 'confirmed' directly and no code
-- path uses 'scheduled' (or any other interim hold status) yet. No behavior
-- change here — just the tripwire comment so whoever adds the first
-- non-'confirmed' interim booking status (e.g. a payment-required hold)
-- sees this and widens the predicate in the same migration, instead of
-- silently reintroducing the double-booking bug this constraint exists to
-- prevent.
comment on constraint bookings_resource_id_during_excl on public.bookings is
  'Only blocks overlap where status = ''confirmed''. TRIPWIRE (docs/LEGACY_LIVE_FINDINGS.md Finding 3): the day any tool call starts writing a non-''confirmed'' interim status (e.g. ''scheduled''/a payment-pending hold) as a real code path, two concurrent holds on the same resource/time will NOT be caught here — widen this predicate in the SAME migration (e.g. to `where (status not in (''cancelled'', ''rescheduled''))`, matching legacy''s live, battle-tested predicate) before that status is ever written.';
