-- GAP_REGISTER.md §2 Motel item 2 — `check_availability` accepted
-- `offering_id`/`resource_type` but had no room-tier dimension at all:
-- `resources.type` is a coarse enum (`'room'` for every motel resource
-- regardless of tier), so a caller asking for a specific room type could
-- never actually be filtered to the resources that ARE that type. A new
-- `room_type` column (rather than repurposing `resources.type`'s existing
-- enum, which every other vertical also depends on) narrows WITHIN
-- `resource_type` — nullable and vertical-agnostic in principle (any
-- vertical with resource sub-tiers, e.g. a dental chair type or a
-- restaurant table zone, can use it later), not motel-exclusive by schema.
-- Additive only (CLAUDE.md Rule 2).

alter table public.resources
  add column if not exists room_type text;

create index if not exists idx_resources_tenant_room_type
  on public.resources (tenant_id, room_type)
  where active and room_type is not null;

comment on column public.resources.room_type is
  'Optional sub-type tag narrowing within `type` (GAP_REGISTER.md §2 Motel item 2) — e.g. a motel''s room tier ("queen", "king", "suite") when `type = ''room''`. check_availability.ts filters on this when the caller specifies a room type; null/unset means "no sub-tier distinction for this resource" and never excludes it from an unfiltered search.';
