-- SIGNUP-1: marks a tenant created by the internal test-checkout bypass
-- (`api-admin-complete-test-checkout` — Stripe is not configured for this
-- platform, so the real `/api-checkout` -> Stripe Checkout -> webhook path
-- cannot be driven end-to-end without it; this column + that function let
-- the REST of the real provisioning path be proven live, never used for a
-- real paying tenant). Additive, defaults false so every existing/real
-- tenant is unaffected.
alter table public.tenants add column is_test boolean not null default false;
