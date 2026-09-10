-- public.fn_enqueue_message_outbound — PostgREST-exposed RPC wrapping
-- pgmq.send('messages_outbound_queue', ...) (docs/audit/FIX_REQUESTS.md,
-- cluster D ask). Same gap as fn_enqueue_adapter_push: pgmq isn't reachable
-- from a Next.js Route Handler, so any tenant-dashboard action that inserts
-- a messages_outbound row (booking confirm/reschedule/cancel
-- notifications, the Messages thread "reply" feature) can insert the row
-- but had no way to enqueue it — worker-messages-outbound only ever reads
-- from pgmq.read('messages_outbound_queue', ...), never scans
-- messages_outbound by status='queued' directly.
--
-- Tenant-scoped by checking the message row's own tenant_id against the
-- caller's JWT tenant_id (same pattern as fn_enqueue_adapter_push) rather
-- than trusting a client-supplied tenant_id — no-ops (never raises) on a
-- mismatch or a message_id that doesn't belong to the caller.
--
-- FIX-1: both real callers (apps/web's `api/tenant/bookings/[id]` and
-- `api/tenant/messages/[phone]` routes) invoke this RPC through a
-- service-role Supabase client (`createSupabaseServiceRoleServerClient()`),
-- not the tenant's own authenticated session — `messages_outbound` has no
-- tenant client-write RLS policy, so the row insert itself already goes
-- through service-role. A service-role PostgREST request carries the
-- `service_role` JWT, which has no `app_metadata.tenant_id` claim, so the
-- original `tenant_id = public.fn_jwt_tenant_id()` check always compared
-- against NULL and silently no-op'd — the row stayed `status: 'queued'`
-- forever and every SMS notification/reply silently never sent. Both call
-- sites already verify the caller's own session tenant_id and stamp it onto
-- the `messages_outbound` row themselves before calling this RPC (see the
-- doc comments on those two route files), so a `service_role` caller here
-- is already tenant-verified upstream — same trust boundary CLAUDE.md Rule
-- 2 grants every other service-role code path in this schema. Only
-- `authenticated` callers (no such route exists today, but the RPC is
-- `grant`ed to that role too) still get the strict own-tenant match.
create or replace function public.fn_enqueue_message_outbound(p_message_id uuid)
returns void
security definer
set search_path = ''
language plpgsql as $$
declare
  v_jwt_role text := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
begin
  if v_jwt_role = 'service_role' then
    if not exists (select 1 from public.messages_outbound where id = p_message_id) then
      return;
    end if;
  elsif not exists (
    select 1 from public.messages_outbound
    where id = p_message_id and tenant_id = public.fn_jwt_tenant_id()
  ) then
    return;
  end if;

  perform pgmq.send('messages_outbound_queue', jsonb_build_object('message_id', p_message_id));
end;
$$;

comment on function public.fn_enqueue_message_outbound(uuid) is
  'PostgREST RPC entry point for enqueuing a messages_outbound_queue message from apps/web (docs/audit/FIX_REQUESTS.md). A service_role caller (both real call sites) is trusted as already tenant-verified upstream and only needs p_message_id to exist; an authenticated caller must additionally own the row via its own JWT tenant_id. No-ops (never raises) otherwise.';

grant execute on function public.fn_enqueue_message_outbound(uuid) to authenticated, service_role;
