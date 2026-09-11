-- Seed data for local development (`supabase start` / `supabase db reset`).
-- Wired via supabase/config.toml [db.seed] sql_paths. NEVER contains real
-- credentials — no auth.users/memberships rows are seeded here (a local
-- signup/login flow or `supabase auth admin` creates real accounts, then
-- links them to these demo tenants via a memberships insert by hand).
--
-- 1. platform_settings: per-vertical price cards (SYSTEM_DESIGN §1) +
--    referral/usage-alert/segment-threshold config.
-- 2. One demo tenant per vertical with resources, offerings, and business
--    hours, plus a populated availability_slots window (via
--    fn_regenerate_availability_slots) so check_availability has real data
--    to read against in local dev.

-- ===================================================================
-- 1. platform_settings
-- ===================================================================

-- Channels (BACKEND_SPEC.md §13.3, `20260911110000_channels_pricing_and_
-- usage.sql`): every price card also carries `included_text_conversations`/
-- `text_conversation_overage_cents` (the text-agent metering unit — per
-- outbound AI message, see that migration's own DECIDE note). Carried here
-- explicitly, not left to that migration's own idempotent `jsonb ||` merge,
-- because this insert's own `on conflict (key) do update set value =
-- excluded.value` REPLACES the whole jsonb value on every `supabase db
-- reset` — without these two keys in the literal below, a reset would
-- silently wipe them back out immediately after the migration merged them
-- in (docs/audit/CHANNELS_REQUESTS.md item 2, verified empirically).
insert into public.platform_settings (key, value) values
  ('price_card_auto',  '{"base_cents":29900,"included_minutes":300,"overage_cents":35,"included_text_conversations":200,"text_conversation_overage_cents":5}'),
  ('price_card_vet',   '{"base_cents":34900,"included_minutes":500,"overage_cents":40,"included_text_conversations":200,"text_conversation_overage_cents":5}'),
  ('price_card_legal',        '{"base_cents":39900,"included_minutes":300,"overage_cents":45,"included_text_conversations":200,"text_conversation_overage_cents":5}'),
  ('price_card_dental',       '{"base_cents":34900,"included_minutes":350,"overage_cents":40,"included_text_conversations":200,"text_conversation_overage_cents":5}'),
  ('price_card_real_estate',  '{"base_cents":34900,"included_minutes":150,"overage_cents":40,"included_text_conversations":200,"text_conversation_overage_cents":5}'),
  ('price_card_motel',        '{"base_cents":29900,"included_minutes":400,"overage_cents":35,"included_text_conversations":200,"text_conversation_overage_cents":5}'),
  ('price_card_restaurant',   '{"base_cents":24900,"included_minutes":500,"overage_cents":30,"included_text_conversations":200,"text_conversation_overage_cents":5}'),
  ('price_card_generic',      '{"base_cents":29900,"included_minutes":300,"overage_cents":40,"included_text_conversations":200,"text_conversation_overage_cents":5}')
on conflict (key) do update set value = excluded.value, updated_at = now();

insert into public.platform_settings (key, value) values
  ('referral_flat_amount_cents', '{"flat_amount_cents":20000}'),
  ('referral_qualification_rule', '{"rule":"paid_invoices_gte","value":2}'),
  ('usage_alert_thresholds', '{"warn_pct":0.8,"critical_pct":1.0}'),
  ('segment_thresholds', '{"vip_bookings":10,"vip_ltv_cents":100000,"loyal_bookings":4,"returning_bookings":2}')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- ===================================================================
-- 2. Demo tenants (one per vertical) + resources/offerings/hours
-- ===================================================================

-- ---- auto --------------------------------------------------
do $$
declare
  v_tenant_id uuid;
  v_bay1 uuid;
  v_bay2 uuid;
begin
  insert into public.tenants (name, slug, vertical, business_type, timezone, business_hours)
  values ('Demo Auto Repair', 'demo-auto-repair', 'auto', 'Auto repair shop', 'America/New_York',
    '{"mon":[{"open":"08:00","close":"18:00"}],"tue":[{"open":"08:00","close":"18:00"}],
      "wed":[{"open":"08:00","close":"18:00"}],"thu":[{"open":"08:00","close":"18:00"}],
      "fri":[{"open":"08:00","close":"18:00"}],"sat":[{"open":"09:00","close":"13:00"}],"sun":[]}'::jsonb)
  returning id into v_tenant_id;

  insert into public.resources (tenant_id, type, name) values (v_tenant_id, 'bay', 'Bay 1') returning id into v_bay1;
  insert into public.resources (tenant_id, type, name) values (v_tenant_id, 'bay', 'Bay 2') returning id into v_bay2;

  insert into public.offerings (tenant_id, name, category, duration_minutes, price_cents, resource_type_required) values
    (v_tenant_id, 'Oil change', 'maintenance', 30, 6500, 'bay'),
    (v_tenant_id, 'Brake inspection', 'maintenance', 30, 0, 'bay'),
    (v_tenant_id, 'Check engine diagnostic', 'diagnostic', 60, 12000, 'bay');

  perform public.fn_regenerate_availability_slots(v_tenant_id, v_bay1);
  perform public.fn_regenerate_availability_slots(v_tenant_id, v_bay2);
end $$;

-- ---- vet -----------------------------------------------------
do $$
declare
  v_tenant_id uuid;
  v_room1 uuid;
begin
  insert into public.tenants (name, slug, vertical, business_type, timezone, business_hours)
  values ('Demo Veterinary Clinic', 'demo-vet', 'vet', 'Veterinary clinic', 'America/Chicago',
    '{"mon":[{"open":"08:00","close":"18:00"}],"tue":[{"open":"08:00","close":"18:00"}],
      "wed":[{"open":"08:00","close":"18:00"}],"thu":[{"open":"08:00","close":"18:00"}],
      "fri":[{"open":"08:00","close":"18:00"}],"sat":[{"open":"09:00","close":"12:00"}],"sun":[]}'::jsonb)
  returning id into v_tenant_id;

  insert into public.resources (tenant_id, type, name) values (v_tenant_id, 'room', 'Exam Room 1') returning id into v_room1;

  insert into public.offerings (tenant_id, name, category, duration_minutes, price_cents, resource_type_required) values
    (v_tenant_id, 'Wellness exam', 'exam', 30, 6000, 'room'),
    (v_tenant_id, 'Vaccination', 'exam', 15, 4500, 'room'),
    (v_tenant_id, 'Sick visit', 'exam', 30, 7500, 'room');

  perform public.fn_regenerate_availability_slots(v_tenant_id, v_room1);
end $$;

-- ---- legal ------------------------------------------------------------
do $$
declare
  v_tenant_id uuid;
  v_attorney uuid;
begin
  insert into public.tenants (name, slug, vertical, business_type, timezone, business_hours)
  values ('Demo Legal Intake', 'demo-legal', 'legal', 'Personal injury law firm', 'America/New_York',
    '{"mon":[{"open":"09:00","close":"17:00"}],"tue":[{"open":"09:00","close":"17:00"}],
      "wed":[{"open":"09:00","close":"17:00"}],"thu":[{"open":"09:00","close":"17:00"}],
      "fri":[{"open":"09:00","close":"17:00"}],"sat":[],"sun":[]}'::jsonb)
  returning id into v_tenant_id;

  insert into public.resources (tenant_id, type, name) values (v_tenant_id, 'staff', 'Intake Attorney') returning id into v_attorney;

  insert into public.offerings (tenant_id, name, category, duration_minutes, price_cents, resource_type_required) values
    (v_tenant_id, 'Free consultation', 'consult', 30, 0, 'staff'),
    (v_tenant_id, 'Case review', 'consult', 45, 0, 'staff');

  perform public.fn_regenerate_availability_slots(v_tenant_id, v_attorney);
end $$;

-- ---- dental -------------------------------------------------------------
do $$
declare
  v_tenant_id uuid;
  v_chair1 uuid;
begin
  insert into public.tenants (name, slug, vertical, business_type, timezone, business_hours)
  values ('Demo Dental Practice', 'demo-dental', 'dental', 'General dentistry', 'America/Los_Angeles',
    '{"mon":[{"open":"08:00","close":"17:00"}],"tue":[{"open":"08:00","close":"17:00"}],
      "wed":[{"open":"08:00","close":"17:00"}],"thu":[{"open":"08:00","close":"17:00"}],
      "fri":[{"open":"08:00","close":"14:00"}],"sat":[],"sun":[]}'::jsonb)
  returning id into v_tenant_id;

  insert into public.resources (tenant_id, type, name, metadata) values
    (v_tenant_id, 'chair', 'Chair 1', '{"slot_minutes":15}'::jsonb) returning id into v_chair1;

  insert into public.offerings (tenant_id, name, category, duration_minutes, price_cents, resource_type_required) values
    (v_tenant_id, 'Cleaning', 'hygiene', 30, 12000, 'chair'),
    (v_tenant_id, 'Checkup + X-ray', 'exam', 45, 18000, 'chair'),
    (v_tenant_id, 'Filling', 'restorative', 60, 25000, 'chair');

  perform public.fn_regenerate_availability_slots(v_tenant_id, v_chair1);
end $$;

-- ---- real_estate ----------------------------------------------------
do $$
declare
  v_tenant_id uuid;
  v_agent uuid;
begin
  insert into public.tenants (name, slug, vertical, business_type, timezone, business_hours)
  values ('Demo Realty Group', 'demo-real-estate', 'real_estate', 'Residential brokerage', 'America/Denver',
    '{"mon":[{"open":"09:00","close":"18:00"}],"tue":[{"open":"09:00","close":"18:00"}],
      "wed":[{"open":"09:00","close":"18:00"}],"thu":[{"open":"09:00","close":"18:00"}],
      "fri":[{"open":"09:00","close":"18:00"}],"sat":[{"open":"10:00","close":"15:00"}],"sun":[]}'::jsonb)
  returning id into v_tenant_id;

  insert into public.resources (tenant_id, type, name) values (v_tenant_id, 'staff', 'Showing Agent') returning id into v_agent;

  insert into public.offerings (tenant_id, name, category, duration_minutes, price_cents, resource_type_required) values
    (v_tenant_id, 'Property showing', 'showing', 30, 0, 'staff'),
    (v_tenant_id, 'Buyer consultation', 'consult', 45, 0, 'staff');

  perform public.fn_regenerate_availability_slots(v_tenant_id, v_agent);
end $$;

-- ---- motel ------------------------------------------------------------
do $$
declare
  v_tenant_id uuid;
  v_room1 uuid;
  v_room2 uuid;
begin
  insert into public.tenants (name, slug, vertical, business_type, timezone, business_hours)
  values ('Demo Roadside Motel', 'demo-motel', 'motel', 'Roadside motel', 'America/Chicago',
    '{"mon":[{"open":"00:00","close":"23:59"}],"tue":[{"open":"00:00","close":"23:59"}],
      "wed":[{"open":"00:00","close":"23:59"}],"thu":[{"open":"00:00","close":"23:59"}],
      "fri":[{"open":"00:00","close":"23:59"}],"sat":[{"open":"00:00","close":"23:59"}],
      "sun":[{"open":"00:00","close":"23:59"}]}'::jsonb)
  returning id into v_tenant_id;

  insert into public.resources (tenant_id, type, name) values (v_tenant_id, 'room', 'Room 101') returning id into v_room1;
  insert into public.resources (tenant_id, type, name) values (v_tenant_id, 'room', 'Room 102') returning id into v_room2;

  insert into public.offerings (tenant_id, name, category, price_cents, resource_type_required) values
    (v_tenant_id, 'Standard queen room', 'room', 8900, 'room'),
    (v_tenant_id, 'Double queen room', 'room', 10900, 'room');

  perform public.fn_regenerate_availability_slots(v_tenant_id, v_room1);
  perform public.fn_regenerate_availability_slots(v_tenant_id, v_room2);
end $$;

-- ---- restaurant ---------------------------------------------------------
do $$
declare
  v_tenant_id uuid;
  v_table1 uuid;
begin
  insert into public.tenants (name, slug, vertical, business_type, timezone, business_hours)
  values ('Demo Trattoria', 'demo-restaurant', 'restaurant', 'Italian restaurant', 'America/New_York',
    '{"mon":[],"tue":[{"open":"11:00","close":"21:00"}],"wed":[{"open":"11:00","close":"21:00"}],
      "thu":[{"open":"11:00","close":"21:00"}],"fri":[{"open":"11:00","close":"22:00"}],
      "sat":[{"open":"11:00","close":"22:00"}],"sun":[{"open":"12:00","close":"20:00"}]}'::jsonb)
  returning id into v_tenant_id;

  insert into public.resources (tenant_id, type, name, capacity) values (v_tenant_id, 'table', 'Table 1', 4) returning id into v_table1;

  insert into public.offerings (tenant_id, name, category, price_cents, metadata) values
    (v_tenant_id, 'Margherita pizza', 'entree', 1600, '{}'),
    (v_tenant_id, 'Spaghetti carbonara', 'entree', 1800, '{}'),
    (v_tenant_id, 'Tiramisu', 'dessert', 900, '{}');

  perform public.fn_regenerate_availability_slots(v_tenant_id, v_table1);
end $$;

-- ---- generic ------------------------------------------------------------
do $$
declare
  v_tenant_id uuid;
  v_staff uuid;
begin
  insert into public.tenants (name, slug, vertical, business_type, timezone, business_hours)
  values ('Demo Generic Business', 'demo-generic', 'generic', 'General service business', 'America/New_York',
    '{"mon":[{"open":"09:00","close":"17:00"}],"tue":[{"open":"09:00","close":"17:00"}],
      "wed":[{"open":"09:00","close":"17:00"}],"thu":[{"open":"09:00","close":"17:00"}],
      "fri":[{"open":"09:00","close":"17:00"}],"sat":[],"sun":[]}'::jsonb)
  returning id into v_tenant_id;

  insert into public.resources (tenant_id, type, name) values (v_tenant_id, 'staff', 'Front Desk') returning id into v_staff;

  insert into public.offerings (tenant_id, name, category, duration_minutes, price_cents, resource_type_required) values
    (v_tenant_id, 'Consultation', 'consult', 30, 0, 'staff');

  perform public.fn_regenerate_availability_slots(v_tenant_id, v_staff);
end $$;
