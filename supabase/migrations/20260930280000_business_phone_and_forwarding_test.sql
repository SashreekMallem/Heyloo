-- Business phone number + outbound forwarding test (LAUNCH-forwarding).
--
-- 1. tenants.business_phone: the number the business's customers already
--    call (the line that forwards to its Heyloo number). Asked at signup
--    step 1, editable in phone setup and settings; the forwarding test dials
--    it, and it becomes the agent's
--    transfer number when none was set. E.164 like every other stored number.
--    Owner-editable, so it joins the column allow-list from
--    20260929160000_lock_owner_writes_to_editable_columns.
--
--    tenants.website_url: optional, asked beside it at signup step 1; the
--    onboarding website import reads it (next phase).
--
-- 2. phone_numbers.forwarding_test_started_at / forwarding_test_call_id: the
--    forwarding test now places a real call from the platform's test line to
--    business_phone and is polled for its result; these hold the running
--    test so the status poll and the per-number cooldown need no extra table.
--    Written only by the forwarding-verify edge function (secret key).

alter table public.tenants
  add column if not exists business_phone text;

alter table public.tenants
  add constraint tenants_business_phone_e164_format_chk
  check (business_phone is null or business_phone ~ '^\+[1-9]\d{1,14}$');

comment on column public.tenants.business_phone is
  'The business''s existing customer-facing number (E.164) that forwards to its Heyloo number. Dialed by the forwarding test; default transfer destination.';

alter table public.tenants
  add column if not exists website_url text;

alter table public.tenants
  add constraint tenants_website_url_format_chk
  check (website_url is null or website_url ~* '^https?://[^\s]+$');

comment on column public.tenants.website_url is
  'The business''s own website (optional, asked at signup step 1). Source for the onboarding website import.';

grant update (business_phone, website_url) on public.tenants to authenticated;

alter table public.phone_numbers
  add column if not exists forwarding_test_started_at timestamptz,
  add column if not exists forwarding_test_call_id text;

comment on column public.phone_numbers.forwarding_test_started_at is
  'When the latest outbound forwarding test call was placed (forwarding-verify start); drives the status poll window and cooldown.';
comment on column public.phone_numbers.forwarding_test_call_id is
  'Retell call id of the latest outbound forwarding test call, used to explain a failed test.';
