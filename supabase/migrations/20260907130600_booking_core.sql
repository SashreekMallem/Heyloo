-- Booking core domain. BACKEND_SPEC.md §1.4.
-- MASTER_SPEC.md §3.4 adds waitlist_entries; §3.7 adds
-- bookings.identity_verified_by.

create table public.offerings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  category text,
  duration_minutes int,
  price_cents int,
  resource_type_required text,
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_offerings_tenant_active on public.offerings (tenant_id) where active;

create trigger trg_offerings_updated_at
  before update on public.offerings
  for each row execute function public.fn_set_updated_at();

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  type text not null check (type in ('chair','room','table','bay','staff','agent')),
  name text not null,
  capacity int not null default 1,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_resources_tenant_active on public.resources (tenant_id) where active;

comment on column public.resources.metadata is
  'May carry {"slot_minutes": <int>} to override the vertical-default availability-slot subdivision granularity used by fn_regenerate_availability_slots.';

-- availability_slots (precomputed, SYSTEM_DESIGN §5) ----------------------

create table public.availability_slots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  resource_id uuid not null references public.resources(id),
  slot_range tstzrange not null,
  is_available boolean not null default true,
  source text not null default 'generated'
    check (source in ('generated','manual_block','schedule_change')),
  generated_at timestamptz not null default now()
);

create index idx_availability_slots_range on public.availability_slots
  using gist (resource_id, slot_range);
create index idx_availability_slots_open on public.availability_slots (tenant_id, resource_id, lower(slot_range))
  where is_available;

comment on table public.availability_slots is
  'Materialized 21 days ahead by default (30 for motels per MASTER_SPEC §2), rolled forward nightly. Pre-subdivided at generation time (30-min default, per-night for motels, dental option 15-min via resources.metadata) so the hot-path read is a single indexed range-overlap check with zero runtime arithmetic — see fn_regenerate_availability_slots.';

-- bookings -----------------------------------------------------------------

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  resource_id uuid not null references public.resources(id),
  offering_id uuid references public.offerings(id),
  customer_id uuid references public.customers(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  during tstzrange generated always as (tstzrange(start_at, end_at, '[)')) stored,
  status text not null default 'scheduled'
    check (status in ('scheduled','confirmed','checked_in','completed',
                       'no_show','cancelled','rescheduled')),
  party_size int,
  source_call_id uuid references public.call_logs(id),
  idempotency_key text,
  notes text,
  structured_payload jsonb not null default '{}'::jsonb,
  cancel_reason text,
  cancelled_at timestamptz,
  -- MASTER_SPEC §3.7 — identity fallback when caller number != booking
  -- customer's number: verified by full name + exact appointment time.
  identity_verified_by text check (identity_verified_by is null or identity_verified_by in ('phone_match','knowledge')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_idempotency_unique unique (tenant_id, idempotency_key),
  exclude using gist (resource_id with =, during with &&)
    where (status = 'confirmed')
);

create index idx_bookings_tenant_time on public.bookings (tenant_id, start_at);
create index idx_bookings_customer on public.bookings (customer_id);

create trigger trg_bookings_updated_at
  before update on public.bookings
  for each row execute function public.fn_set_updated_at();

comment on column public.bookings.idempotency_key is
  'call_id || '':'' || slot_start_iso by convention — a Retell tool-call retry with the same key returns the existing row, never a duplicate.';
comment on constraint bookings_idempotency_unique on public.bookings is
  'Multiple NULLs allowed (Postgres unique-constraint semantics) for non-voice/manual bookings that never carry an idempotency key.';

-- orders (restaurant/POS specialization) -----------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  customer_id uuid references public.customers(id),
  items jsonb not null,
  fulfillment_type text not null check (fulfillment_type in ('pickup','delivery','dine_in')),
  delivery_address jsonb,
  subtotal_cents int not null,
  tax_cents int not null default 0,
  tip_cents int not null default 0,
  total_cents int not null,
  status text not null default 'received'
    check (status in ('received','confirmed','preparing','ready','completed','cancelled')),
  source_call_id uuid references public.call_logs(id),
  pos_order_id text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_idempotency_unique unique (tenant_id, idempotency_key)
);

create index idx_orders_tenant_created on public.orders (tenant_id, created_at desc);
create index idx_orders_customer on public.orders (customer_id);

create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.fn_set_updated_at();

comment on column public.orders.items is
  '[{offering_id, name, qty, unit_price_cents, modifiers[]}] — validated against offerings by the create_order tool (MASTER_SPEC §3.0), never model-invented.';

-- waitlist_entries (MASTER_SPEC §3.4) --------------------------------------

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  customer_id uuid not null references public.customers(id),
  offering_id uuid references public.offerings(id),
  resource_type text,
  "window" tstzrange not null,
  status text not null default 'active'
    check (status in ('active','notified','converted','expired')),
  created_at timestamptz not null default now()
);

create index idx_waitlist_entries_tenant_status on public.waitlist_entries (tenant_id, status);
create index idx_waitlist_entries_window on public.waitlist_entries using gist ("window");

comment on table public.waitlist_entries is
  'When check_availability returns none, agent offers waitlist; the booking-cancellation trigger matches active entries by window overlap and enqueues an SMS ("a slot opened Tue 2pm — reply YES") — reply handled by the two-way SMS pipeline (messages_inbound), YES auto-books via the same idempotent create_booking path.';
