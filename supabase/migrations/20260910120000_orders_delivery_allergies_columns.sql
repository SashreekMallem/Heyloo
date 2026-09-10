-- GAP_REGISTER.md §2 Restaurant item 2 + §4 Cluster D — `create_order` had
-- no typed destination for an explicit allergy/special-instructions ask
-- (the template mandates asking, `orders` had nowhere to persist the
-- answer) and no delivery-fee column (only `subtotal_cents`/`tax_cents`/
-- `total_cents` existed, so a delivery fee had to be folded silently into
-- the subtotal or dropped). Additive only (CLAUDE.md Rule 2) — every new
-- column is nullable or has a safe default, so this applies cleanly against
-- the populated `orders` table from `20260907130600_booking_core.sql`.

alter table public.orders
  add column if not exists allergies text[],
  add column if not exists special_instructions text,
  add column if not exists delivery_fee_cents int not null default 0;

comment on column public.orders.allergies is
  'Captured from create_order''s explicit allergy ask (GAP_REGISTER.md §2 Restaurant item 2) — null/empty when the caller reported none or the vertical never asks.';
comment on column public.orders.special_instructions is
  'Free-text caller-supplied delivery/prep instructions, distinct from allergies (a structured list) — e.g. "leave at door", "extra napkins".';
comment on column public.orders.delivery_fee_cents is
  'Tenant-configured flat delivery fee (agent_configs.dynamic_variable_overrides.delivery_fee_cents), applied only when fulfillment_type = ''delivery'' — 0 for pickup/dine_in and for a tenant with no fee configured. Already included in total_cents (subtotal + tax + delivery fee), kept as its own column so it''s recoverable without re-deriving from the total.';
