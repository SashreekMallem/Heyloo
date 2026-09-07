-- Telephony domain. BACKEND_SPEC.md §1.2.

create table public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  e164 text not null,
  twilio_sid text not null,
  retell_number_id text,
  forwarding_mode text not null default 'conditional'
    check (forwarding_mode in ('conditional','full')),
  forwarding_verified_at timestamptz,
  forwarding_carrier text,
  spam_label_status text not null default 'unknown'
    check (spam_label_status in ('unknown','clean','flagged','remediating')),
  cnam_registered boolean not null default false,
  is_primary boolean not null default true,
  released_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index phone_numbers_e164_key on public.phone_numbers (e164);
create unique index phone_numbers_twilio_sid_key on public.phone_numbers (twilio_sid);
create index idx_phone_numbers_tenant_active on public.phone_numbers (tenant_id) where released_at is null;
