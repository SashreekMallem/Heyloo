-- Channels — tenant-level text-agent/widget config + call_logs channel tag
-- (Cluster S build task, 2026-09-11). BACKEND_SPEC.md §13. Additive only.

alter table public.tenants
  -- Master switch for the SMS/web-chat text agent (independent of voice —
  -- a tenant can run voice-only, text-only, or both). Off by default so no
  -- existing tenant starts auto-replying to texts the moment this column
  -- lands.
  add column text_agent_enabled boolean not null default false,
  -- Text-agent tone/persona overrides, same "typed but Zod-validated by the
  -- runtime, not the DB" posture as agent_configs.dynamic_variable_
  -- overrides (BACKEND_SPEC §1.3) — kept a free-form jsonb here rather than
  -- a rigid column set since the text-agent runtime (a different task's
  -- scope) owns the actual shape.
  add column text_agent_persona jsonb not null default '{}'::jsonb,
  -- Quiet hours the text agent (and, per MASTER_SPEC §3.6's existing
  -- reminder-scheduler quiet-hours enforcement, a natural future voice-
  -- reminder consumer too) checks before auto-replying overnight —
  -- deliberately separate from tenants.business_hours (which governs
  -- availability/booking slots, a different concept): a tenant may want
  -- the text agent to stay silent 9pm-9am even though the business itself,
  -- and the voice agent, keep answering after-hours calls.
  add column quiet_hours jsonb not null default '{}'::jsonb,
  -- Embeddable widget (voice + chat) master switch and config.
  add column widget_enabled boolean not null default false,
  add column widget_settings jsonb not null default
    '{"allowed_origins":[],"accent":null,"position":"bottom-right","greeting":null,"modes":["chat"]}'::jsonb,
  -- Opaque, rotatable public identifier embedded in the tenant's widget
  -- script tag (client-visible by design — it is NOT a secret; the actual
  -- session auth is WIDGET_TOKEN_SECRET-signed server-side, see
  -- .env.example). Nullable until first generated/rotated by whichever
  -- cluster builds the widget-settings save flow; null = widget cannot be
  -- embedded yet even if widget_enabled is somehow true.
  add column widget_public_key text;

create unique index tenants_widget_public_key_key
  on public.tenants (widget_public_key)
  where widget_public_key is not null;

comment on column public.tenants.quiet_hours is
  'Text-agent (and future voice-reminder) quiet-hours gate, tenant-tz local time, 24h: {"start":"21:00","end":"09:00","enabled":true}. Distinct from business_hours (booking availability) and hours_exceptions (holiday closures).';
comment on column public.tenants.widget_settings is
  'Embeddable widget config: {"allowed_origins":["https://example.com"],"accent":"#0EA5E9","position":"bottom-right"|"bottom-left","greeting":"Hi! How can we help?","modes":["voice","chat"]}. allowed_origins gates which pages may embed the widget (checked server-side against the Origin header when minting a session, alongside widget_public_key); modes controls whether the widget offers voice, chat, or both.';
comment on column public.tenants.widget_public_key is
  'Opaque, rotatable, client-visible identifier embedded in the tenant''s widget script tag — not a secret by itself; see WIDGET_TOKEN_SECRET (.env.example) for the actual session-signing key.';

-- call_logs.channel — RECONCILED SHAPE (integrator pass, 2026-09-11,
-- resolving docs/audit/CHANNELS_REQUESTS.md item 1/item 6). This column
-- originally shipped here as a 2-value ('phone'|'web') enum describing a
-- real voice call's origination, while a concurrently-landed Cluster T
-- migration (20260911120000_text_conversations.sql) independently added
-- the SAME column as a different 2-value ('voice'|'sms'|'web_chat') enum
-- describing whether a call_logs row is a real call at all vs. a shadow
-- row for a text conversation — applying both failed outright ("column
-- channel already exists"). Cluster T's own item-6 follow-up correctly
-- identified both axes as genuinely needed simultaneously — a call_logs
-- row can be a real PSTN voice call, a real widget voice call, an SMS
-- shadow row, or a web-chat shadow row — so the reconciled column is a
-- single 4-value enum covering both axes at once, defined ONCE here
-- (20260911120000_text_conversations.sql no longer re-adds it — see that
-- file's own updated header comment). Default stays 'phone' since every
-- pre-existing call_logs row (and every real Twilio-originated call
-- voice-events inserts without setting this column explicitly) is a
-- regular phone call.
alter table public.call_logs
  add column channel text not null default 'phone'
    check (channel in ('phone', 'web_voice', 'sms', 'web_chat'));

create index idx_call_logs_tenant_channel on public.call_logs (tenant_id, channel);

comment on column public.call_logs.channel is
  'phone = inbound to a Twilio number (the existing default, set implicitly since voice-events never overrides it); web_voice = the embeddable widget''s voice mode (BACKEND_SPEC §13.2 — not yet written explicitly by voice-events, a known gap, see docs/BUILD_NOTES.md); sms/web_chat = a shadow row created by the text-agent engine (_shared/text-agent/conversation-store.ts''s ensureShadowCallLog) so the unmodified voice-tools/tools/*.ts handlers can be reused verbatim for text-originated bookings — duration_seconds/recording_url/transcript/cost_cents stay null on these rows. Voice-only dashboards/rollups should filter channel in (''phone'',''web_voice'').';
