-- text_conversation_messages (Cluster T text-agent engine follow-up).
-- Additive, self-contained — references ONLY this cluster's own
-- `text_conversations` table (20260911120000_text_conversations.sql,
-- uncontested in content, only its filename collides with a concurrently-
-- landed Cluster S migration — see docs/audit/CHANNELS_REQUESTS.md item 1
-- and docs/BUILD_NOTES.md's Cluster T entries) — deliberately does NOT
-- touch `call_logs`/`usage_daily` again, to avoid deepening that unresolved
-- conflict.
--
-- Fills a real, independently-confirmed gap (docs/audit/CHANNELS_REQUESTS.md
-- item 5, filed by Cluster W): the dashboard's "AI vs human vs customer"
-- message-thread authorship view has nowhere to read that distinction from
-- under this cluster's design — `text_conversations.recent_turns` is a
-- BOUNDED working-memory window (trimmed to the last
-- `MAX_REPLAYED_TURNS`, `_shared/text-agent/conversation-store.ts`), never
-- the full transcript, and SMS's own audit trail
-- (`messages_inbound`/`messages_outbound`) has no column distinguishing an
-- AI-generated outbound reply from a human dashboard operator's manual
-- one. This table is the full, unbounded, author-tagged transcript for
-- BOTH channels (sms and web_chat) — `_shared/text-agent/conversation-
-- store.ts`'s `saveConversationPatch` writes a row here for every turn it
-- also appends to `recent_turns`, deriving `author` from the turn's own
-- role ('user' -> 'customer', 'assistant' -> 'ai'); a future dashboard
-- "reply"/"take over" write path (Cluster W's own UI, out of this
-- cluster's ownership) inserts `author = 'human'` rows directly, permitted
-- by the RLS policy below.

create table public.text_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  conversation_id uuid not null references public.text_conversations(id),
  author text not null check (author in ('customer', 'ai', 'human')),
  body text not null,
  created_at timestamptz not null default now()
);

create index idx_text_conversation_messages_conversation
  on public.text_conversation_messages (conversation_id, created_at);
create index idx_text_conversation_messages_tenant
  on public.text_conversation_messages (tenant_id, created_at desc);

comment on table public.text_conversation_messages is
  'Full, unbounded, author-tagged transcript for text_conversations (both sms and web_chat) — distinct from the bounded text_conversations.recent_turns working-memory window and from the pre-existing messages_inbound/messages_outbound audit trail, neither of which distinguishes an AI-generated reply from a human dashboard operator''s one (docs/audit/CHANNELS_REQUESTS.md item 5).';

create trigger trg_broadcast_text_conversation_messages after insert on public.text_conversation_messages
  for each row execute function public.fn_broadcast_tenant_update();

alter table public.text_conversation_messages enable row level security;

create policy text_conversation_messages_select on public.text_conversation_messages for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

-- Only a human dashboard reply may be client-inserted (and only into the
-- caller's own tenant) — 'customer'/'ai' rows are written exclusively by
-- the engine's own service_role connection, which bypasses RLS entirely
-- (CLAUDE.md Rule 2's "service_role bypasses, but every edge function
-- still filters by a verified tenant_id itself" posture, same as every
-- other service_role-only write path in this schema).
create policy text_conversation_messages_human_reply on public.text_conversation_messages for insert
  with check (
    tenant_id = public.fn_jwt_tenant_id()
    and public.fn_jwt_role() in ('owner', 'admin', 'member')
    and author = 'human'
  );
