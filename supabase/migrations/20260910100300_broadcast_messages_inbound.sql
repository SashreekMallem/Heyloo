-- messages_inbound broadcast trigger (docs/audit/FIX_REQUESTS.md, cluster D
-- ask; independently flagged in docs/audit/E2E_FLOWS_AUDIT.md §3.3).
-- messages_inbound's own table comment
-- (20260907130700_messaging.sql) already describes it as "broadcast to the
-- tenant channel", but no trigger wiring that up ever landed — this adds
-- the missing trg_broadcast_messages_inbound, same shape as the existing
-- trg_broadcast_call_logs/_bookings/_orders/_support_requests
-- (20260907131400_functions_triggers.sql, fn_broadcast_tenant_update()),
-- additive only.

create trigger trg_broadcast_messages_inbound after insert or update on public.messages_inbound
  for each row execute function public.fn_broadcast_tenant_update();
