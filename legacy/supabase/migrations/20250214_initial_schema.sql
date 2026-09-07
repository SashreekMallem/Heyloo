-- Enable required extensions
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- Helper function for updated_at timestamps
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Restaurants
create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  phone_number text not null unique,
  owner_email text not null,
  subscription_status text not null default 'trial' check (subscription_status in ('trial','active','paused','cancelled')),
  pos_type text not null default 'none' check (pos_type in ('square','toast','clover','none')),
  tax_rate numeric(5,4) not null default 0.0825,
  delivery_fee numeric(10,2) not null default 5.00,
  stripe_account_id text,
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_restaurants_updated_at
  before update on public.restaurants
  for each row execute procedure set_updated_at();

-- Application users
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('platform_admin','restaurant_admin')),
  restaurant_id uuid references public.restaurants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_app_users_updated_at
  before update on public.app_users
  for each row execute procedure set_updated_at();

-- Menu items
create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  description text,
  price numeric(10,2) not null,
  category text,
  pos_item_id text,
  sync_source text default 'manual',
  last_synced_at timestamptz,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_price_positive check (price >= 0)
);

create unique index if not exists idx_menu_items_restaurant_pos_item
  on public.menu_items(restaurant_id, pos_item_id)
  where pos_item_id is not null;

create index if not exists idx_menu_items_restaurant_category
  on public.menu_items(restaurant_id, category);

create trigger trg_menu_items_updated_at
  before update on public.menu_items
  for each row execute procedure set_updated_at();

-- Customers
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  phone_number text not null,
  first_name text,
  last_name text,
  email text,
  notes text,
  total_orders integer not null default 0,
  total_spent numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_customer_phone unique (restaurant_id, phone_number)
);

create index if not exists idx_customers_restaurant_id
  on public.customers(restaurant_id);

create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute procedure set_updated_at();

-- Customer addresses
create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  label text,
  street text not null,
  city text not null,
  state text not null,
  postal_code text not null,
  delivery_instructions text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_addresses_customer
  on public.customer_addresses(customer_id);

-- Orders
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  customer_phone text not null,
  customer_name text,
  order_type text not null check (order_type in ('delivery','pickup')),
  status text not null default 'pending' check (
    status in ('pending','payment_pending','paid','confirmed','preparing','ready','out_for_delivery','delivered','picked_up','cancelled')
  ),
  payment_status text not null default 'pending' check (
    payment_status in ('pending','paid','failed','refunded')
  ),
  payment_method text not null check (payment_method in ('stripe_link','cash','card_on_delivery')),
  subtotal numeric(12,2) not null,
  tax numeric(12,2) not null,
  delivery_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  items jsonb not null,
  stripe_payment_link text,
  stripe_payment_intent_id text,
  call_id text,
  source text not null default 'dashboard',
  placed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_restaurant_status
  on public.orders(restaurant_id, status);

create index if not exists idx_orders_restaurant_placed_at
  on public.orders(restaurant_id, placed_at desc);

create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute procedure set_updated_at();

-- Call logs
create table if not exists public.call_logs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  call_id text not null unique,
  customer_phone text,
  duration_seconds integer,
  transcript jsonb,
  status text not null check (status in ('in_progress','completed','failed')),
  event_type text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_call_logs_restaurant_created_at
  on public.call_logs(restaurant_id, created_at desc);

create trigger trg_call_logs_updated_at
  before update on public.call_logs
  for each row execute procedure set_updated_at();

-- Platform usage daily aggregates
create table if not exists public.platform_usage_daily (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  date date not null,
  total_calls integer not null default 0,
  successful_calls integer not null default 0,
  failed_calls integer not null default 0,
  total_minutes numeric(12,2) not null default 0,
  total_orders integer not null default 0,
  delivery_orders integer not null default 0,
  pickup_orders integer not null default 0,
  total_order_value numeric(14,2) not null default 0,
  vapi_call_cost numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_usage_per_day unique (restaurant_id, date)
);

create index if not exists idx_platform_usage_restaurant_date
  on public.platform_usage_daily(restaurant_id, date desc);

create trigger trg_platform_usage_daily_updated_at
  before update on public.platform_usage_daily
  for each row execute procedure set_updated_at();

-- Subscription invoices
create table if not exists public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  billing_period_start date not null,
  billing_period_end date not null,
  base_fee_cents integer not null,
  included_minutes integer not null default 0,
  overage_minutes integer not null default 0,
  overage_rate_cents integer not null default 0,
  total_amount_cents integer not null,
  stripe_invoice_id text,
  status text not null default 'draft' check (status in ('draft','pending','paid','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscription_invoices_restaurant_period
  on public.subscription_invoices(restaurant_id, billing_period_start desc);

create trigger trg_subscription_invoices_updated_at
  before update on public.subscription_invoices
  for each row execute procedure set_updated_at();

-- POS sync logs
create table if not exists public.pos_sync_log (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  sync_type text not null check (sync_type in ('menu_sync','order_push','webhook')),
  sync_source text not null check (sync_source in ('webhook','cron','manual')),
  status text not null check (status in ('success','failed')),
  items_processed integer not null default 0,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pos_sync_log_restaurant_created_at
  on public.pos_sync_log(restaurant_id, created_at desc);

-- Aggregated view for restaurant usage
create or replace view public.restaurant_usage_summary as
select
  u.restaurant_id,
  r.name as restaurant_name,
  r.subscription_status,
  u.date,
  u.total_calls,
  u.total_minutes,
  u.total_orders,
  u.total_order_value
from public.platform_usage_daily u
join public.restaurants r on r.id = u.restaurant_id;

-- Stored procedures for metrics updates
create or replace function public.increment_customer_totals(
  p_customer_id uuid,
  p_order_total numeric
) returns void
language plpgsql
security definer
as $$
begin
  update public.customers
  set
    total_orders = total_orders + 1,
    total_spent = total_spent + coalesce(p_order_total, 0),
    updated_at = now()
  where id = p_customer_id;
end;
$$;

create or replace function public.record_order_usage(
  p_restaurant_id uuid,
  p_order_total numeric,
  p_order_type text
) returns void
language plpgsql
security definer
as $$
declare
  order_delivery integer := case when lower(p_order_type) = 'delivery' then 1 else 0 end;
  order_pickup integer := case when lower(p_order_type) = 'pickup' then 1 else 0 end;
  usage_date date := (now() at time zone 'utc')::date;
begin
  insert into public.platform_usage_daily (
    restaurant_id,
    date,
    total_orders,
    delivery_orders,
    pickup_orders,
    total_order_value
  )
  values (
    p_restaurant_id,
    usage_date,
    1,
    order_delivery,
    order_pickup,
    coalesce(p_order_total, 0)
  )
  on conflict (restaurant_id, date)
  do update set
    total_orders = public.platform_usage_daily.total_orders + 1,
    delivery_orders = public.platform_usage_daily.delivery_orders + order_delivery,
    pickup_orders = public.platform_usage_daily.pickup_orders + order_pickup,
    total_order_value = public.platform_usage_daily.total_order_value + coalesce(p_order_total, 0),
    updated_at = now();
end;
$$;

create or replace function public.record_call_usage(
  p_restaurant_id uuid,
  p_call_duration_seconds integer,
  p_outcome text
) returns void
language plpgsql
security definer
as $$
declare
  usage_date date := (now() at time zone 'utc')::date;
  call_minutes numeric := round(coalesce(p_call_duration_seconds, 0) / 60.0, 2);
  call_cost numeric := round(call_minutes * 0.05, 2);
  is_success boolean := lower(coalesce(p_outcome, '')) = 'completed';
begin
  insert into public.platform_usage_daily (
    restaurant_id,
    date,
    total_calls,
    successful_calls,
    failed_calls,
    total_minutes,
    vapi_call_cost
  )
  values (
    p_restaurant_id,
    usage_date,
    1,
    case when is_success then 1 else 0 end,
    case when is_success then 0 else 1 end,
    call_minutes,
    call_cost
  )
  on conflict (restaurant_id, date)
  do update set
    total_calls = public.platform_usage_daily.total_calls + 1,
    successful_calls = public.platform_usage_daily.successful_calls + case when is_success then 1 else 0 end,
    failed_calls = public.platform_usage_daily.failed_calls + case when is_success then 0 else 1 end,
    total_minutes = public.platform_usage_daily.total_minutes + call_minutes,
    vapi_call_cost = public.platform_usage_daily.vapi_call_cost + call_cost,
    updated_at = now();
end;
$$;

-- Row Level Security policies
alter table public.menu_items enable row level security;
alter table public.customers enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.orders enable row level security;
alter table public.call_logs enable row level security;
alter table public.platform_usage_daily enable row level security;
alter table public.subscription_invoices enable row level security;
alter table public.pos_sync_log enable row level security;

create policy "Menu items are accessible by tenant" on public.menu_items
  using (restaurant_id = current_setting('app.tenant_id', true)::uuid);

create policy "Customers are accessible by tenant" on public.customers
  using (restaurant_id = current_setting('app.tenant_id', true)::uuid);

create policy "Customer addresses are accessible by tenant" on public.customer_addresses
  using (restaurant_id = current_setting('app.tenant_id', true)::uuid);

create policy "Orders are accessible by tenant" on public.orders
  using (restaurant_id = current_setting('app.tenant_id', true)::uuid);

create policy "Call logs are accessible by tenant" on public.call_logs
  using (restaurant_id = current_setting('app.tenant_id', true)::uuid);

create policy "Platform usage is accessible by tenant" on public.platform_usage_daily
  using (restaurant_id = current_setting('app.tenant_id', true)::uuid);

create policy "Invoices are accessible by tenant" on public.subscription_invoices
  using (restaurant_id = current_setting('app.tenant_id', true)::uuid);

create policy "POS sync logs are accessible by tenant" on public.pos_sync_log
  using (restaurant_id = current_setting('app.tenant_id', true)::uuid);
