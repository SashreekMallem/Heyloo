-- Referral program. BACKEND_SPEC.md §1.7.
-- Ordered before the money domain (deviation from the doc's own section
-- numbering, §1.6 before §1.7) because commission_events.referral_id and
-- .referral_partner_id FK into tables defined here — see docs/BUILD_NOTES.md.

create table public.referral_partners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  name text not null,
  email text not null,
  payout_method text not null default 'paypal',
  paypal_email text,
  w9_status text not null default 'not_submitted'
    check (w9_status in ('not_submitted','submitted','verified')),
  ytd_payout_cents int not null default 0,
  fraud_flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.referral_links (
  id uuid primary key default gen_random_uuid(),
  referral_partner_id uuid not null references public.referral_partners(id),
  code text not null,
  created_at timestamptz not null default now(),
  constraint referral_links_code_unique unique (code)
);

create index idx_referral_links_partner on public.referral_links (referral_partner_id);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referral_link_id uuid references public.referral_links(id),
  referral_partner_id uuid not null references public.referral_partners(id),
  referred_tenant_id uuid not null references public.tenants(id),
  attribution_source text not null check (attribution_source in ('link','cookie')),
  status text not null default 'pending'
    check (status in ('pending','qualified','paid','clawed_back','disqualified')),
  qualified_at timestamptz,
  amount_cents_snapshot int,
  fraud_flag boolean not null default false,
  created_at timestamptz not null default now(),
  constraint referrals_referred_tenant_unique unique (referred_tenant_id)
);

create index idx_referrals_partner on public.referrals (referral_partner_id);

create table public.referral_payouts (
  id uuid primary key default gen_random_uuid(),
  referral_partner_id uuid not null references public.referral_partners(id),
  period date not null,
  total_cents int not null,
  paypal_batch_id text,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  created_at timestamptz not null default now()
);

create index idx_referral_payouts_partner on public.referral_payouts (referral_partner_id);

-- Deferred FKs from tenants (declared plain uuid in the tenancy migration
-- since these tables did not exist yet).
alter table public.tenants
  add constraint tenants_referrer_partner_id_fkey
    foreign key (referrer_partner_id) references public.referral_partners(id),
  add constraint tenants_referral_link_id_fkey
    foreign key (referral_link_id) references public.referral_links(id);
