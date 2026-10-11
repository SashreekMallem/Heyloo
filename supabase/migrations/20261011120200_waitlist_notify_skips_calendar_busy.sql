-- CAL-1b: a cancellation must not text the waitlist about a time the owner
-- has since filled in their connected Google Calendar. The voice tools and
-- the waitlist YES auto-book (webhooks-sms) already skip any slot that
-- overlaps public.external_busy_blocks (20261011120000_external_busy_blocks.
-- sql); this applies the same filter to the notification itself, so nobody
-- is offered a slot they could not book.
--
-- Replaces public.fn_notify_waitlist_on_cancellation with the CURRENT body
-- from 20260929163000_waitlist_notify_enqueue.sql (NUMBERS-1: queued insert
-- + pgmq.send, SECURITY DEFINER, empty search_path, only schema-qualified
-- references) plus one condition on the waitlist match: no busy block of
-- this tenant, tenant-wide (resource_id null) or on the freed booking's
-- resource, overlaps the freed slot. Heyloo's own Google-pushed bookings
-- are subtracted from the blocks at sync time, so the cancelled booking's
-- own calendar event does not block its own slot.
--
-- Additive: CREATE OR REPLACE keeps the existing trigger
-- trg_bookings_notify_waitlist bound to this function name (and the
-- function's owner and grants).
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
        and not exists (
          select 1 from public.external_busy_blocks x
          where x.tenant_id = new.tenant_id
            and (x.resource_id is null or x.resource_id = new.resource_id)
            and x.busy && new.during
        )
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
  'Matches active waitlist_entries whose window overlaps a freed slot, marks them notified, inserts a queued waitlist_slot_opened SMS per match and enqueues it on messages_outbound_queue (NUMBERS-1). CAL-1b: skipped when the freed slot overlaps an external_busy_blocks row of the tenant (tenant-wide or the booking''s resource), i.e. the owner filled it in their Google Calendar. SECURITY DEFINER, empty search_path.';
