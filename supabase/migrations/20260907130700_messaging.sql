-- Calls & messaging domain (remainder). BACKEND_SPEC.md §1.5.
-- MASTER_SPEC.md §3.2 adds payment_links; §3.3 adds messages_inbound.

create table public.messages_outbound (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  channel text not null check (channel in ('sms','email','push','airtable')),
  recipient text not null,
  template_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued','sent','delivered','failed','bounced','pending_verification')),
  provider_message_id text,
  related_call_id uuid references public.call_logs(id),
  related_booking_id uuid references public.bookings(id),
  related_order_id uuid references public.orders(id),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index idx_messages_outbound_tenant_created on public.messages_outbound (tenant_id, created_at desc);
create index idx_messages_outbound_pending on public.messages_outbound (status) where status in ('queued','pending_verification');

-- messages_inbound (MASTER_SPEC §3.3) --------------------------------------

create table public.messages_inbound (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  phone_number_id uuid references public.phone_numbers(id),
  customer_id uuid references public.customers(id),
  from_e164 text not null,
  to_e164 text not null,
  body text not null,
  twilio_message_sid text,
  classification text not null default 'other'
    check (classification in ('stop','help','other')),
  handled boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_messages_inbound_tenant_created on public.messages_inbound (tenant_id, created_at desc);
create unique index messages_inbound_twilio_sid_key on public.messages_inbound (twilio_message_sid) where twilio_message_sid is not null;

comment on table public.messages_inbound is
  'Two-way SMS on our numbers (MASTER_SPEC §3.3): STOP/UNSUBSCRIBE sets customers.sms_opt_out and is handled without a row here reaching "unhandled" state; HELP gets a static reply; everything else lands here, broadcast to the tenant channel, and surfaces in the dashboard call/booking thread + notification.';

-- webhook_events -------------------------------------------------------

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  signature_verified boolean not null,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now(),
  constraint webhook_events_source_event_unique unique (source, event_id)
);

comment on table public.webhook_events is
  'The idempotent-insert gate every webhook handler writes to before fast-acking (CLAUDE.md Rule 2). unique(source, event_id) makes a retried delivery a no-op.';

-- payment_links (MASTER_SPEC §3.2) -----------------------------------------

create table public.payment_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  order_id uuid references public.orders(id),
  booking_id uuid references public.bookings(id),
  stripe_checkout_session_id text,
  amount_cents int not null,
  purpose text not null check (purpose in ('order','deposit','noshow_fee')),
  status text not null default 'pending'
    check (status in ('pending','sent','paid','expired','cancelled')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_payment_links_tenant on public.payment_links (tenant_id, created_at desc);
create index idx_payment_links_stripe_session on public.payment_links (stripe_checkout_session_id) where stripe_checkout_session_id is not null;

create trigger trg_payment_links_updated_at
  before update on public.payment_links
  for each row execute function public.fn_set_updated_at();

comment on table public.payment_links is
  'send_payment_link tool enqueues an SMS with a Stripe Checkout/Payment Link; booking/order marked paid on checkout.session.completed matching metadata (MASTER_SPEC §3.2). No card numbers ever spoken/stored — PCI stance unchanged.';
