-- Customers domain. BACKEND_SPEC.md §1.4 (customers table).
-- MASTER_SPEC.md §3.1 adds customer_addresses; §3.3/§3.6 add
-- customers.sms_opt_out/consent.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  phone_e164 text not null,
  name text,
  email text,
  segment text not null default 'new'
    check (segment in ('new','returning','loyal','vip')),
  lifetime_value_cents int not null default 0,
  lifetime_bookings int not null default 0,
  lifetime_calls int not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  -- MASTER_SPEC §3.3 — Two-way SMS + STOP handling.
  sms_opt_out boolean not null default false,
  -- MASTER_SPEC §3.6 — captured once at booking time:
  -- {sms: bool, call: bool, captured_at: timestamptz, call_id: uuid}
  consent jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint customers_tenant_phone_unique unique (tenant_id, phone_e164)
);

create index idx_customers_tenant_segment on public.customers (tenant_id, segment);

comment on column public.customers.metadata is
  'Vertical-specific: pets array (vet), vehicles array (auto), addresses (delivery, superseded by customer_addresses for structured use).';

-- customer_addresses (MASTER_SPEC §3.1) -----------------------------------

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  customer_id uuid not null references public.customers(id),
  label text,
  street text not null,
  city text,
  state text,
  zip text,
  geocode point,
  delivery_instructions text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_customer_addresses_customer on public.customer_addresses (customer_id);
create index idx_customer_addresses_tenant on public.customer_addresses (tenant_id);

comment on column public.customer_addresses.geocode is
  'Native Postgres point (lng, lat) — no PostGIS dependency. Precomputed at address-save time by the demo-scraper''s geocoding provider (MASTER_SPEC §3.0 VERIFY: Geocodio vs Google, picked at build by T3/T7).';
