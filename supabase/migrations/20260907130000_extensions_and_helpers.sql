-- Extensions & schema-wide setup.
-- BACKEND_SPEC.md §0. CLAUDE.md Rule 1: pg_cron/pgmq/pg_net ship preinstalled
-- on Supabase-hosted Postgres; a plain local Postgres (no Supabase platform
-- image) will not have those three available as installable extensions —
-- see docs/BUILD_NOTES.md (task T1) for exactly how this was verified in an
-- environment without Docker/`supabase start` available.
create extension if not exists pgcrypto;      -- gen_random_uuid()
create extension if not exists btree_gist;    -- GIST exclusion on scalar + range (bookings, availability_slots)
create extension if not exists pg_cron;       -- scheduled jobs (BACKEND_SPEC §8, wired by T3/T4 — extension only, no jobs registered here)
create extension if not exists pgmq;          -- queues (BACKEND_SPEC §9, wired by T3/T4 — extension only, no queues created here)
create extension if not exists pg_net;        -- async HTTP from triggers/cron (wired by T3/T4)

-- Generic "maintain updated_at" trigger function used by most tables below
-- that carry an `updated_at` column (BACKEND_SPEC §0).
create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.fn_set_updated_at() is
  'Generic BEFORE UPDATE trigger: stamps updated_at = now() on every row update. Attached per-table in the migration that creates that table.';
