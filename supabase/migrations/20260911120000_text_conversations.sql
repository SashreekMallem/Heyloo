-- Text agent engine (CLUSTER T / BUILD_PLAN text-agent task). Not present
-- in BACKEND_SPEC.md (its own §1.5 "Calls & messaging" predates the
-- Anthropic-tool-use text engine this task builds — the spec's own A.1 SMS
-- section assumed Retell's native chat-agent SMS channel instead; this
-- build's own explicit instruction directs the Anthropic-Messages-API
-- engine over the SAME voice-tools implementations, documented as a
-- deliberate deviation in docs/BUILD_NOTES.md "Cluster T" entry) — this
-- migration is additive schema this task's own ownership doesn't otherwise
-- cover a home for (supabase/migrations/** has no dedicated owning cluster
-- in this run), filed for awareness in docs/audit/CHANNELS_REQUESTS.md.
--
-- `call_logs.channel` and `usage_daily.text_messages_out` originally lived
-- here too (added by this file directly) but collided with a concurrently-
-- landed Cluster S migration adding the same two columns with a different
-- shape (docs/audit/CHANNELS_REQUESTS.md item 1). RESOLVED (integrator
-- pass, 2026-09-11): both columns are now defined exactly once, in
-- `20260911101000_channels_tenant_and_call_log_columns.sql` (call_logs.
-- channel — reconciled to a single 4-value enum, 'phone'|'web_voice'|
-- 'sms'|'web_chat', covering both this cluster's shadow-row axis and
-- Cluster S's real-voice-origination axis, per this cluster's own item-6
-- follow-up recommendation) and `20260911110000_channels_pricing_and_
-- usage.sql` (usage_daily.text_messages_out — that migration's
-- `fn_upsert_usage_daily` was updated to never overwrite this column,
-- since this cluster's engine owns it via a direct per-message increment,
-- not a nightly rollup). This file no longer re-adds either column; a
-- text conversation's shadow `call_logs` row still gets `channel = 'sms'`
-- or `channel = 'web_chat'` exactly as before
-- (`_shared/text-agent/conversation-store.ts`'s `ensureShadowCallLog`,
-- unchanged), and this cluster's own `usage_daily.text_messages_out`
-- increment (`conversation-store.ts`, unchanged) is unaffected — only the
-- schema-ownership of the two columns moved to the migrations above.
--
-- One new table remains this file's own deliverable:
--
-- `text_conversations` — per-(tenant, phone) SMS thread state, or
--    per-(tenant, widget_session) web-chat thread state. A LIVE, mutated-
--    in-place row (not an append-only log like `messages_inbound`/
--    `messages_outbound`, which this table sits alongside and references
--    via `call_log_id`) — the engine's `structured_state` is a compact,
--    summarized memory of the conversation so a turn never resends full
--    history beyond the last few messages (this task's own instruction).
create table public.text_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  channel text not null check (channel in ('sms', 'web_chat')),

  -- SMS: always the texter's own E.164 number, resolved from the inbound
  -- webhook, never trusted from a client payload. Web chat: null until the
  -- customer verifies a phone by SMS code (see verification_* below) or
  -- provides one directly on a booking/order tool call (that path never
  -- promotes to `phone_e164` here — lookup_customer stays unauthorized for
  -- the rest of the session either way, per this task's identity rule).
  phone_e164 text,
  customer_id uuid references public.customers(id),

  -- Web chat only: the opaque widget session token's hash (sha256, same
  -- "token IS the credential" pattern as `intake_tokens.token_hash`) —
  -- api-text-chat mints the token on first turn, hashes it here, and every
  -- subsequent turn resolves this row by re-hashing the presented token.
  widget_session_token_hash text,

  -- The shadow call_logs row this conversation's tool calls write through
  -- (see the `call_logs.channel` comment above). Created lazily on first
  -- tool call, not on conversation creation, so a conversation that never
  -- reaches a tool call never creates a phantom call_logs row at all.
  call_log_id uuid references public.call_logs(id),

  -- 'open': the engine replies normally. 'human': an owner has taken over
  -- from the dashboard (cluster W's UI; this column is the state transition
  -- this task exposes) — the engine records inbound messages but never
  -- replies. 'closed': conversation considered done; a new inbound message
  -- reopens it to 'open' (webhooks-twilio-sms/api-text-chat both do this).
  status text not null default 'open' check (status in ('open', 'human', 'closed')),

  structured_state jsonb not null default '{}'::jsonb,
  -- Compact recent-turn window actually replayed to the model each call
  -- (bounded — see _shared/text-agent/conversation-store.ts MAX_TRANSCRIPT_TURNS)
  -- distinct from the full audit trail already durable in
  -- messages_inbound/messages_outbound.
  recent_turns jsonb not null default '[]'::jsonb,

  disclosure_sent boolean not null default false,

  -- Web-chat phone verification (this task's identity rule: lookup_customer
  -- returns nothing until the customer confirms a phone by SMS code).
  -- Never set for channel = 'sms' (already phone-authenticated by the
  -- inbound webhook itself).
  verification_phone_e164 text,
  verification_code_hash text,
  verification_code_expires_at timestamptz,
  verification_attempts int not null default 0,

  message_count int not null default 0,
  ai_message_count int not null default 0,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live thread per (tenant, phone) for SMS — a new inbound message
-- resumes the same row (status flips 'closed'/'human' -> unaffected;
-- 'closed' -> 'open') rather than forking conversation state.
create unique index text_conversations_sms_phone_key
  on public.text_conversations (tenant_id, phone_e164)
  where channel = 'sms' and phone_e164 is not null;

create unique index text_conversations_webchat_session_key
  on public.text_conversations (tenant_id, widget_session_token_hash)
  where channel = 'web_chat' and widget_session_token_hash is not null;

create index idx_text_conversations_tenant_updated
  on public.text_conversations (tenant_id, updated_at desc);

create index idx_text_conversations_human
  on public.text_conversations (tenant_id) where status = 'human';

create trigger trg_text_conversations_updated_at
  before update on public.text_conversations
  for each row execute function public.fn_set_updated_at();

-- Realtime broadcast for the dashboard message thread, same convention as
-- messages_inbound/call_logs/bookings/orders (fn_broadcast_tenant_update
-- from 20260907131400_functions_triggers.sql).
create trigger trg_broadcast_text_conversations after insert or update on public.text_conversations
  for each row execute function public.fn_broadcast_tenant_update();

comment on table public.text_conversations is
  'Cluster T text-agent engine: one live, mutated-in-place row per SMS phone thread or per web-chat widget session. structured_state/recent_turns are the engine''s compact working memory; the full message audit trail stays in messages_inbound/messages_outbound as before.';

-- RLS (CLAUDE.md Rule 2: tenant_id from JWT app_metadata only; same select-
-- only posture as messages_inbound/messages_outbound/call_logs — writes are
-- service_role-only from the edge functions, which additionally always
-- filter by a verified tenant_id in the query itself, RLS bypass never
-- substituting for that).
alter table public.text_conversations enable row level security;

create policy text_conversations_select on public.text_conversations for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

-- Dashboard human-takeover/resume (cluster W UI) flips `status` between
-- 'open' and 'human' as a tenant member/admin action — the only client-
-- writable field, and only that one transition, so the update policy scopes
-- both USING and WITH CHECK to the row's own tenant and restricts columns
-- via the same "own tenant member" check the rest of the schema uses
-- (BACKEND_SPEC §5 pattern); the engine's own writes (service_role) bypass
-- RLS entirely as documented above.
create policy text_conversations_human_takeover on public.text_conversations for update
  using (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner', 'admin', 'member'))
  with check (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner', 'admin', 'member'));
