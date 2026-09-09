-- DEPLOY-1 fix: 20260907140000 created public.tool_health without enabling
-- row level security — the only table violating CLAUDE.md Rule 2's
-- "RLS on every table" invariant (caught during first live deployment
-- verification). tool_health is written asynchronously by /voice-tools
-- (service key) and read only by the admin cockpit views; clients get no
-- policies at all, so enabling RLS with zero permissive policies yields the
-- intended default-deny posture (service_role bypasses RLS).

alter table public.tool_health enable row level security;
