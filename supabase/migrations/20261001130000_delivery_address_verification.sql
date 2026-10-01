-- DELIVERY-1: delivery address verification + distance-from-business check
-- (restaurant delivery). Additive only.
--
-- 1. tenants: the business's own street address, delivery radius and
--    distance-based delivery charge, owner-editable from Agent -> Business (joins the column allow-list from
--    20260929160000_lock_owner_writes_to_editable_columns, same as
--    20260930280000's business_phone). The geocoded location of that address
--    (lat/lng, the Census matched address, the normalized address string that
--    was geocoded, when) is SYSTEM-only: written by the edge functions with
--    the secret key, never granted to authenticated, so an owner cannot place
--    their business somewhere it is not.
--
-- 2. delivery_address_checks: one row per caller delivery address the voice
--    agent checked (check_delivery_address, or create_order's inline check).
--    Tenant members may read their own rows; only the service role writes.
--
-- 3. orders.address_verification: the outcome of that check for a delivery
--    order (null = not a delivery order / written before this column), so the
--    owner sees which delivery addresses were never verified.

-- ---------------------------------------------------------------------
-- 1. tenants
-- ---------------------------------------------------------------------
alter table public.tenants
  add column if not exists business_street text,
  add column if not exists business_city text,
  add column if not exists business_state text,
  add column if not exists business_zip text,
  add column if not exists delivery_radius_miles numeric(5,2),
  add column if not exists delivery_fee_base_cents int,
  add column if not exists delivery_fee_per_mile_cents int,
  add column if not exists delivery_fee_included_miles numeric(5,2),
  add column if not exists delivery_min_order_cents int,
  add column if not exists business_lat double precision,
  add column if not exists business_lng double precision,
  add column if not exists business_location_matched text,
  add column if not exists business_location_key text,
  add column if not exists business_located_at timestamptz;

alter table public.tenants
  add constraint tenants_business_street_length_chk
  check (business_street is null or char_length(business_street) between 1 and 200);

alter table public.tenants
  add constraint tenants_business_city_length_chk
  check (business_city is null or char_length(business_city) between 1 and 100);

alter table public.tenants
  add constraint tenants_business_state_format_chk
  check (business_state is null or business_state ~ '^[A-Z]{2}$');

alter table public.tenants
  add constraint tenants_business_zip_format_chk
  check (business_zip is null or business_zip ~ '^\d{5}(-\d{4})?$');

alter table public.tenants
  add constraint tenants_delivery_radius_miles_range_chk
  check (delivery_radius_miles is null or (delivery_radius_miles > 0 and delivery_radius_miles <= 100));

alter table public.tenants
  add constraint tenants_delivery_fee_nonnegative_chk
  check (
    (delivery_fee_base_cents is null or delivery_fee_base_cents >= 0)
    and (delivery_fee_per_mile_cents is null or delivery_fee_per_mile_cents >= 0)
    and (delivery_fee_included_miles is null or delivery_fee_included_miles >= 0)
    and (delivery_min_order_cents is null or delivery_min_order_cents >= 0)
  );

alter table public.tenants
  add constraint tenants_business_location_range_chk
  check (
    (business_lat is null or business_lat between -90 and 90)
    and (business_lng is null or business_lng between -180 and 180)
  );

comment on column public.tenants.business_street is
  'Business street address (owner-editable, Agent -> Business). Geocoded into business_lat/lng for the delivery-distance check.';
comment on column public.tenants.business_city is
  'Business city (owner-editable).';
comment on column public.tenants.business_state is
  'Business state, 2-letter US code, upper case (owner-editable).';
comment on column public.tenants.business_zip is
  'Business ZIP code, 12345 or 12345-6789 (owner-editable).';
comment on column public.tenants.delivery_radius_miles is
  'Restaurant delivery radius in miles (owner-editable, 0 < r <= 100). Null = not set: delivery addresses are located but never refused for distance.';
comment on column public.tenants.delivery_fee_base_cents is
  'Delivery charge in cents before any per-mile charge (owner-editable, >= 0). Null = 0. fee = base + ceil(per_mile * max(0, miles - included_miles)).';
comment on column public.tenants.delivery_fee_per_mile_cents is
  'Delivery charge in cents per straight-line mile beyond delivery_fee_included_miles (owner-editable, >= 0). Null = 0.';
comment on column public.tenants.delivery_fee_included_miles is
  'Miles covered by the base delivery fee before the per-mile charge starts (owner-editable, >= 0). Null = 0.';
comment on column public.tenants.delivery_min_order_cents is
  'Minimum order subtotal in cents for delivery (owner-editable, >= 0). Null = no minimum.';
comment on column public.tenants.business_lat is
  'Latitude of the business address (US Census Geocoder). System-only: written by ensureBusinessLocation with the secret key.';
comment on column public.tenants.business_lng is
  'Longitude of the business address (US Census Geocoder). System-only.';
comment on column public.tenants.business_location_matched is
  'The Census Geocoder matchedAddress for the business address. System-only.';
comment on column public.tenants.business_location_key is
  'Normalized business address string that business_lat/lng were geocoded from; differs from the current address when the owner edited it (stale, re-geocoded on next use). System-only.';
comment on column public.tenants.business_located_at is
  'When business_lat/lng were last geocoded. System-only.';

grant update (
  business_street, business_city, business_state, business_zip, delivery_radius_miles,
  delivery_fee_base_cents, delivery_fee_per_mile_cents, delivery_fee_included_miles,
  delivery_min_order_cents
) on public.tenants to authenticated;

-- ---------------------------------------------------------------------
-- 2. delivery_address_checks
-- ---------------------------------------------------------------------
create table public.delivery_address_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider_call_id text,
  input_address text not null,
  status text not null check (status in (
    'in_range', 'out_of_range', 'not_found', 'no_business_location', 'no_radius_set', 'lookup_unavailable'
  )),
  matched_address text,
  street text,
  city text,
  state text,
  zip text,
  lat double precision,
  lng double precision,
  distance_miles numeric(7,2),
  created_at timestamptz not null default now()
);

create index idx_delivery_address_checks_tenant_call
  on public.delivery_address_checks (tenant_id, provider_call_id, created_at desc);

comment on table public.delivery_address_checks is
  'DELIVERY-1: every caller delivery address the voice agent checked against the restaurant''s location and delivery radius. Service-role writes only; tenant members read their own.';
comment on column public.delivery_address_checks.provider_call_id is
  'Voice provider call id of the call that ran the check (create_order reuses the latest matching check of the same call).';
comment on column public.delivery_address_checks.input_address is
  'The address as the agent passed it (street, city, state, zip joined), before geocoding.';
comment on column public.delivery_address_checks.status is
  'in_range | out_of_range | not_found (no Census match) | no_business_location (business address missing or unlocatable) | no_radius_set (located, radius not configured) | lookup_unavailable (geocoder timeout/error).';
comment on column public.delivery_address_checks.matched_address is
  'US Census Geocoder matchedAddress for the caller''s address, when found.';
comment on column public.delivery_address_checks.street is
  'Street line of the matched address (house number + street), when found.';
comment on column public.delivery_address_checks.city is
  'City of the matched address, when found.';
comment on column public.delivery_address_checks.state is
  'State of the matched address, when found.';
comment on column public.delivery_address_checks.zip is
  'ZIP of the matched address, when found.';
comment on column public.delivery_address_checks.lat is
  'Latitude of the matched address, when found.';
comment on column public.delivery_address_checks.lng is
  'Longitude of the matched address, when found.';
comment on column public.delivery_address_checks.distance_miles is
  'Straight-line (haversine) distance from the business, when both locations are known.';
comment on column public.delivery_address_checks.created_at is
  'When the check ran.';

alter table public.delivery_address_checks enable row level security;

create policy delivery_address_checks_select on public.delivery_address_checks for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());
-- No client insert/update/delete policy: rows are written by /voice-tools with
-- the secret key only. Table privileges are revoked too (defense in depth).
revoke insert, update, delete, truncate on public.delivery_address_checks from authenticated, anon;
revoke select on public.delivery_address_checks from anon;

-- ---------------------------------------------------------------------
-- 3. orders.address_verification
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists address_verification text;

alter table public.orders
  add constraint orders_address_verification_chk
  check (address_verification is null or address_verification in (
    'in_range', 'not_found', 'no_business_location', 'no_radius_set', 'lookup_unavailable'
  ));

comment on column public.orders.address_verification is
  'DELIVERY-1: outcome of the delivery address check for a delivery order (create_order). in_range = located and within the delivery radius; anything else = the address was NOT verified and the restaurant should confirm it. Null for pickup/dine-in and older orders.';
