-- public.fn_enqueue_adapter_push — PostgREST-exposed RPC wrapping
-- pgmq.send('adapter_push_queue', ...) (docs/audit/FIX_REQUESTS.md, cluster
-- C ask). supabase/config.toml's [api] schemas only exposes public/
-- graphql_public — pgmq itself is not reachable from a Next.js Route
-- Handler (PostgREST only, no raw Postgres connection the way the Deno
-- edge functions have), so a tenant-facing "sync now" action needs this
-- entry point. apps/web/src/app/api/tenant/delivery/airtable/sync-now/
-- route.ts already calls rpc('fn_enqueue_adapter_push', ...) and handles
-- its current absence with an honest 501, never a fake success.
--
-- Tenant-scoped exactly like every other write path in this schema
-- (public.fn_jwt_tenant_id(), set by the Custom Access Token Hook) — a
-- mismatched/missing tenant_id no-ops rather than raising, so this never
-- leaks whether p_tenant_id/p_entity_id exist to a caller who doesn't own
-- them.

create or replace function public.fn_enqueue_adapter_push(
  p_tenant_id uuid,
  p_adapter text,
  p_entity_type text,
  p_entity_id uuid
) returns void
security definer
set search_path = ''
language plpgsql as $$
begin
  if p_tenant_id is null or p_tenant_id is distinct from public.fn_jwt_tenant_id() then
    return;
  end if;

  perform pgmq.send('adapter_push_queue', jsonb_build_object(
    'tenant_id', p_tenant_id,
    'adapter', p_adapter,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'idempotency_key', gen_random_uuid()::text,
    'attempt', 0
  ));
end;
$$;

comment on function public.fn_enqueue_adapter_push(uuid, text, text, uuid) is
  'Tenant-scoped PostgREST RPC entry point for enqueuing an adapter_push_queue message from apps/web (docs/audit/FIX_REQUESTS.md). No-ops (never raises) if p_tenant_id does not match the caller''s own JWT tenant_id.';

grant execute on function public.fn_enqueue_adapter_push(uuid, text, text, uuid) to authenticated;
