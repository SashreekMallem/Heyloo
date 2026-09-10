-- GAP_REGISTER.md §1.2 — the new `join_waitlist` voice tool
-- (supabase/functions/voice-tools/tools/join_waitlist.ts) mirrors
-- `create_booking`'s race-proof/idempotent-insert shape ("never
-- check-then-insert"), which needs a real uniqueness constraint to insert
-- against — `waitlist_entries` (20260907130600_booking_core.sql) had no
-- idempotency key at all, so a Retell retry of the same tool call would
-- have inserted a duplicate waitlist entry. Additive only (CLAUDE.md Rule 2).

alter table public.waitlist_entries
  add column if not exists idempotency_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'waitlist_entries_idempotency_unique'
  ) then
    alter table public.waitlist_entries
      add constraint waitlist_entries_idempotency_unique unique (tenant_id, idempotency_key);
  end if;
end;
$$;

comment on column public.waitlist_entries.idempotency_key is
  'call_id || '':'' || fnv1a(stableStringify(preferred_window)) by convention (join_waitlist.ts) — a Retell tool-call retry with the same key returns the existing row, never a duplicate. Multiple NULLs allowed (Postgres unique-constraint semantics) for any non-voice/manual waitlist entry that never carries one.';
