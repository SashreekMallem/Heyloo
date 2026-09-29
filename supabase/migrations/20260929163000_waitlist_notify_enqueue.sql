-- NUMBERS-1: fn_notify_waitlist_on_cancellation inserted the
-- `waitlist_slot_opened` messages_outbound row but never enqueued it. The
-- outbound worker reads only pgmq.read('messages_outbound_queue'), so the
-- row sat `queued` until the stranded-row sweep (2 min - 24 h old) found it.
-- Replace the function so the row is inserted explicitly as 'queued' and
-- `pgmq.send`-enqueued in the same statement flow (same call
-- public.fn_enqueue_message_outbound makes).
--
-- SECURITY DEFINER + empty search_path: the trigger fires on the bookings
-- UPDATE of whoever cancels (service-role edge functions, and any
-- authenticated session with a bookings write policy). The old invoker
-- version needed that caller to hold INSERT on messages_outbound (RLS: no
-- tenant write policy) and, now, EXECUTE on pgmq.send — neither is granted
-- to tenant sessions, so a tenant-session cancellation would have failed
-- the whole booking update. Every object below is schema-qualified, and the
-- recipient/tenant come only from the cancelled booking's own row
-- (new.tenant_id) joined to that tenant's own waitlist entries.
--
-- Additive: CREATE OR REPLACE keeps the existing trigger
-- trg_bookings_notify_waitlist bound to this function name.
create or replace function public.fn_notify_waitlist_on_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry record;
  v_message_id uuid;
begin
  if tg_op = 'UPDATE' and old.status = 'confirmed' and new.status in ('cancelled','no_show') then
    for v_entry in
      select we.* from public.waitlist_entries we
      where we.tenant_id = new.tenant_id
        and we.status = 'active'
        and we."window" && new.during
    loop
      update public.waitlist_entries set status = 'notified' where id = v_entry.id;

      v_message_id := null;
      insert into public.messages_outbound
        (tenant_id, channel, recipient, template_key, payload, related_booking_id, status)
      select new.tenant_id, 'sms', c.phone_e164, 'waitlist_slot_opened',
             jsonb_build_object('start', lower(new.during), 'waitlist_entry_id', v_entry.id),
             new.id, 'queued'
      from public.customers c
      where c.id = v_entry.customer_id and c.tenant_id = new.tenant_id
      returning id into v_message_id;

      if v_message_id is not null then
        perform pgmq.send(
          'messages_outbound_queue',
          jsonb_build_object('message_id', v_message_id)
        );
      end if;
    end loop;
  end if;
  return new;
end;
$$;

comment on function public.fn_notify_waitlist_on_cancellation() is
  'Matches active waitlist_entries whose window overlaps a freed slot, marks them notified, inserts a queued waitlist_slot_opened SMS per match and enqueues it on messages_outbound_queue (NUMBERS-1: previously inserted without enqueueing). SECURITY DEFINER, empty search_path.';
