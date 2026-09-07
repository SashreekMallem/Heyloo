-- Calls domain — call_logs. BACKEND_SPEC.md §1.5.
-- Created ahead of booking_core because bookings.source_call_id references
-- call_logs(id) (dependency-ordering deviation from the doc's section
-- numbering, not from its content — see docs/BUILD_NOTES.md task T1).

create table public.call_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  phone_number_id uuid references public.phone_numbers(id),
  retell_call_id text not null,
  caller_number text,
  direction text not null default 'inbound'
    check (direction in ('inbound','outbound')),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds int,
  disconnection_reason text,
  classification text
    check (classification is null or classification in (
      'new_booking','reschedule','cancel','question_faq','status_check',
      'sales_lead','solicitor','wrong_number','spam_robocall','emergency',
      'after_hours_message','transfer_request')),
  outcome text,
  sentiment text check (sentiment is null or sentiment in ('positive','neutral','negative')),
  call_successful boolean,
  call_summary text,
  follow_up_needed boolean not null default false,
  urgency_flag boolean not null default false,
  message_text text,
  structured_booking_payload jsonb,
  extracted_entities jsonb,
  state_trace jsonb not null default '[]'::jsonb,
  variable_values jsonb not null default '{}'::jsonb,
  recording_url text,
  stereo_recording_url text,
  transcript jsonb,
  latency_p50_ms int,
  latency_p95_ms int,
  tool_call_count int not null default 0,
  tool_error_count int not null default 0,
  cost_cents int,
  is_test_call boolean not null default false,
  legal_advice_given boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index call_logs_retell_call_id_key on public.call_logs (retell_call_id);
create index idx_call_logs_tenant_started on public.call_logs (tenant_id, started_at desc);
create index idx_call_logs_tenant_classification on public.call_logs (tenant_id, classification);
create index idx_call_logs_urgency on public.call_logs (tenant_id) where urgency_flag;
create index idx_call_logs_caller_number on public.call_logs (caller_number);

comment on column public.call_logs.urgency_flag is
  'Set in-call on red-flag detection, never waiting for post-call analysis (SYSTEM_DESIGN §4.4).';
comment on column public.call_logs.is_test_call is
  'true when caller_number = tenants.owner_test_phone (G13) — excluded from billable usage.';
