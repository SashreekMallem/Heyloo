-- Money domain. BACKEND_SPEC.md §1.6.

create table public.cost_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  call_id uuid references public.call_logs(id),
  provider text not null,
  product text not null,
  quantity numeric,
  unit text check (unit is null or unit in ('minute','unit','message')),
  unit_cost_cents numeric,
  total_cost_cents numeric not null,
  raw jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index idx_cost_events_tenant_occurred on public.cost_events (tenant_id, occurred_at);
create index idx_cost_events_call on public.cost_events (call_id);

create table public.revenue_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  type text not null check (type in ('base_fee','overage','setup_fee','refund','annual_prepay_discount')),
  amount_cents int not null,
  stripe_invoice_item_id text,
  period_start date,
  period_end date,
  created_at timestamptz not null default now()
);

create index idx_revenue_events_tenant_period on public.revenue_events (tenant_id, period_start);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  call_id uuid references public.call_logs(id),
  minutes numeric not null,
  occurred_at timestamptz not null,
  is_billable boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_usage_events_call on public.usage_events (call_id);
create index idx_usage_events_tenant_occurred on public.usage_events (tenant_id, occurred_at);

create table public.usage_daily (
  tenant_id uuid not null references public.tenants(id),
  date date not null,
  total_calls int not null default 0,
  total_minutes numeric not null default 0,
  billable_minutes numeric not null default 0,
  total_bookings int not null default 0,
  total_orders int not null default 0,
  total_order_value_cents int not null default 0,
  price_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, date)
);

create trigger trg_usage_daily_updated_at
  before update on public.usage_daily
  for each row execute function public.fn_set_updated_at();

create table public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  period_start date not null,
  period_end date not null,
  stripe_invoice_id text,
  base_fee_cents int not null,
  included_minutes numeric not null,
  overage_minutes numeric not null default 0,
  overage_cents int not null default 0,
  discount_cents int not null default 0,
  total_cents int not null,
  status text not null default 'draft' check (status in ('draft','finalized','paid','past_due','void')),
  created_at timestamptz not null default now(),
  constraint billing_invoices_tenant_period_unique unique (tenant_id, period_start, period_end)
);

create table public.payment_processing_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  stripe_charge_id text,
  stripe_balance_transaction_id text,
  method text not null check (method in ('card','ach')),
  fee_cents int not null,
  net_cents int not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.commission_events (
  id uuid primary key default gen_random_uuid(),
  referral_partner_id uuid not null references public.referral_partners(id),
  referral_id uuid not null references public.referrals(id),
  tenant_id uuid not null references public.tenants(id),
  amount_cents int not null,
  period date,
  status text not null default 'accrued' check (status in ('accrued','batched','paid','clawed_back')),
  created_at timestamptz not null default now()
);

create index idx_commission_events_partner on public.commission_events (referral_partner_id);
create index idx_commission_events_referral on public.commission_events (referral_id);

create table public.cac_events (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('cold_email','referral','organic','paid_ads')),
  tenant_id uuid references public.tenants(id),
  lead_id uuid references public.leads(id),
  cost_cents int not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.fixed_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  period date not null,
  category text not null check (category in ('infra','tooling','labor','domain_warmup')),
  amount_cents int not null,
  allocation_method text not null check (allocation_method in ('per_active_tenant','flat','per_minute')),
  created_at timestamptz not null default now()
);
