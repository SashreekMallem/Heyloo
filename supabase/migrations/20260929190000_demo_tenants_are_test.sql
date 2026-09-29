-- DEMO-2: the eight public demo tenants are test tenants.
--
-- The website's live demo lets a visitor pick a business type and talk to that
-- AI for up to 30 seconds. Each business type is answered by its own tenant
-- (`api-demo-agent` maps the picked type to one of the slugs below and reads
-- the tenant's Retell agent id from agent_configs). Those tenants exist to
-- take demo calls, never to serve a customer, so their calls and bookings must
-- count as test data: `voice-events` folds `tenants.is_test` into
-- `call_logs.is_test_call` (no owner alerts, `usage_events.is_billable = false`,
-- excluded from the cockpit's margin views), `voice-tools` stamps
-- `bookings.is_test` from that flag, and the reminder / review / value-email
-- jobs skip test bookings.
--
-- Additive data change, idempotent: it touches exactly these eight slugs and
-- only sets a flag (`is_test` defaults false; SIGNUP-1 added the column). The
-- two follow-up updates mark anything a demo tenant already recorded before
-- the flag was set (there is nothing on the live database today; this keeps a
-- from-zero replay with seed data consistent).

update public.tenants
set is_test = true
where slug in (
  'demo-auto-repair',
  'demo-dental',
  'demo-vet',
  'demo-legal',
  'demo-real-estate',
  'demo-motel',
  'demo-restaurant',
  'demo-generic'
)
  and is_test is distinct from true;

update public.call_logs
set is_test_call = true
where is_test_call = false
  and tenant_id in (select id from public.tenants where is_test and slug in ('demo-auto-repair', 'demo-dental', 'demo-vet', 'demo-legal', 'demo-real-estate', 'demo-motel', 'demo-restaurant', 'demo-generic'));

update public.bookings
set is_test = true
where is_test = false
  and tenant_id in (select id from public.tenants where is_test and slug in ('demo-auto-repair', 'demo-dental', 'demo-vet', 'demo-legal', 'demo-real-estate', 'demo-motel', 'demo-restaurant', 'demo-generic'));
