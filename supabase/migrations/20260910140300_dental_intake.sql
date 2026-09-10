-- Dental intake (DOB/insurance) capture (GAP_REGISTER Cluster G item 4 —
-- "secure link for DOB/insurance"). Two tables: `intake_tokens` (an opaque,
-- single-use, tenant/booking-scoped token — only its SHA-256 hash is ever
-- stored, matching `api_tokens.token_hash`'s own "plaintext never stored"
-- convention) and `intake_submissions` (the sensitive fields themselves,
-- AES-256-GCM-encrypted at rest via the SAME `_shared/crypto.ts` helper
-- `adapter_connections.access_token` already uses — `INTAKE_ENCRYPTION_KEY`
-- is a dedicated key, not shared with `ADAPTER_TOKEN_ENCRYPTION_KEY`, so
-- rotating one never touches the other).
--
-- Field/endpoint shape reconciled against docs/audit/FIX_REQUESTS.md's
-- Cluster E entry: the public form page
-- (`apps/web/src/app/[locale]/(marketing)/intake/[token]/page.tsx`) is
-- already built against `GET/POST /functions/v1/api-intake/{token}` and
-- reads back `patient_first_name`/`insurance_group_id` by exactly those
-- names — `intake_tokens.patient_first_name` (snapshotted at issuance,
-- `_shared/dental-intake.ts`) and `insurance_group_id_encrypted` below
-- match that contract; `insurance_group_number_encrypted` was this
-- migration's own working name before that contract was found and is not
-- used (never applied anywhere before this pass, so renaming here is free).
--
-- DOB/insurance must NEVER appear in `call_logs.transcript`/`extracted_
-- entities` — the voice agent only ever SPEAKS the link (sent by SMS,
-- `api-intake` + the hosted form page collect the actual data), never asks
-- for or repeats these fields on the call itself.

create table public.intake_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  booking_id uuid not null references public.bookings(id),
  token_hash text not null,
  -- Snapshotted at issuance (not joined live through
  -- bookings->customers.name) so `GET /api-intake/{token}` stays a single
  -- indexed lookup with no further join, and so the greeting keeps
  -- matching even if the customer record is later edited/merged.
  patient_first_name text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint intake_tokens_token_hash_unique unique (token_hash)
);

create index idx_intake_tokens_booking on public.intake_tokens (booking_id);
create index idx_intake_tokens_tenant on public.intake_tokens (tenant_id);

comment on column public.intake_tokens.token_hash is
  'sha256(token) — the plaintext token is embedded only in the one-time SMS link (messages_outbound payload) and never persisted, same posture as api_tokens.token_hash.';

create table public.intake_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  booking_id uuid not null references public.bookings(id),
  intake_token_id uuid not null references public.intake_tokens(id),
  dob_encrypted text not null,
  insurance_provider_encrypted text,
  insurance_member_id_encrypted text,
  insurance_group_id_encrypted text,
  submitted_ip text,
  created_at timestamptz not null default now(),
  constraint intake_submissions_booking_unique unique (booking_id)
);

create index idx_intake_submissions_tenant on public.intake_submissions (tenant_id);

comment on table public.intake_submissions is
  'DOB/insurance fields, AES-256-GCM-encrypted at rest (INTAKE_ENCRYPTION_KEY, _shared/crypto.ts encryptSecret/decryptSecret — the "v1:<iv>:<ciphertext>" format). RLS intentionally has NO select/insert/update/delete policy for any client role: writes happen only through api-intake (service_role, single-use token as the entire auth boundary) and reads are service-role-only ("tenant read only via service path") — no dashboard decrypt/reveal UI exists yet; a future one would be a dedicated edge function, never a direct PostgREST select of the encrypted columns.';

alter table public.intake_tokens enable row level security;
alter table public.intake_submissions enable row level security;

create policy intake_tokens_select on public.intake_tokens for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());
-- No client INSERT/UPDATE/DELETE policy on either table — both are
-- service-role-only writes (api-intake for intake_submissions + marking a
-- token used; the dental create_booking hook, per
-- docs/audit/FIX_REQUESTS.md, for intake_tokens issuance). Deliberately NO
-- select policy at all on intake_submissions (see its table comment above)
-- — RLS enabled + zero matching policy = default deny, same convention as
-- every other service-role-only table in this codebase.
