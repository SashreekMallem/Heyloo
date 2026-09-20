import { randomOpaqueToken, sha256Hex } from "../crypto.ts";
import type { SqlClient } from "../types.ts";
import type { TenantTextContext, TextChannel, TextConversationRow, TextTurn } from "./types.ts";

/** Bounded recent-turn replay window (this task's own instruction: "do not
 * resend the whole history each turn beyond N messages; summarize"). Kept
 * as raw turns rather than an LLM-summarized blob — see this module's
 * docstring below — so no extra Anthropic call is spent compressing
 * history on every turn (latency/cost budget: "keep prompts lean"). */
export const MAX_REPLAYED_TURNS = 12;

interface TextConversationDbRow {
  id: string;
  tenant_id: string;
  channel: TextChannel;
  phone_e164: string | null;
  customer_id: string | null;
  widget_session_token_hash: string | null;
  call_log_id: string | null;
  status: "open" | "human" | "closed";
  structured_state: Record<string, unknown>;
  recent_turns: TextTurn[];
  disclosure_sent: boolean;
  verification_phone_e164: string | null;
  verification_code_hash: string | null;
  verification_code_expires_at: string | null;
  verification_attempts: number;
  message_count: number;
  ai_message_count: number;
}

function fromDbRow(row: TextConversationDbRow): TextConversationRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    channel: row.channel,
    phoneE164: row.phone_e164,
    customerId: row.customer_id,
    widgetSessionTokenHash: row.widget_session_token_hash,
    callLogId: row.call_log_id,
    status: row.status,
    structuredState: row.structured_state ?? {},
    recentTurns: row.recent_turns ?? [],
    disclosureSent: row.disclosure_sent,
    verificationPhoneE164: row.verification_phone_e164,
    verificationCodeHash: row.verification_code_hash,
    verificationCodeExpiresAt: row.verification_code_expires_at,
    verificationAttempts: row.verification_attempts,
    messageCount: row.message_count,
    aiMessageCount: row.ai_message_count,
  };
}

/**
 * SMS: one live row per (tenant, phone) — a closed thread reopens rather
 * than forking (MASTER_SPEC-style "resume the same customer's thread"
 * convention this codebase already uses for `customers` itself). Never
 * creates the row if `phoneE164` fails to normalize — callers must reject
 * before this.
 */
export async function loadOrCreateSmsConversation(
  sql: SqlClient,
  tenantId: string,
  phoneE164: string,
): Promise<TextConversationRow> {
  const existing = await sql<TextConversationDbRow>`
    select id, tenant_id, channel, phone_e164, customer_id, widget_session_token_hash,
           call_log_id, status, structured_state, recent_turns, disclosure_sent,
           verification_phone_e164, verification_code_hash, verification_code_expires_at,
           verification_attempts, message_count, ai_message_count
    from public.text_conversations
    where tenant_id = ${tenantId} and channel = 'sms' and phone_e164 = ${phoneE164}
    limit 1
  `;

  const row = existing[0];
  if (row) {
    if (row.status === "closed") {
      await sql`update public.text_conversations set status = 'open' where id = ${row.id}`;
      row.status = "open";
    }
    return fromDbRow(row);
  }

  const inserted = await sql<TextConversationDbRow>`
    insert into public.text_conversations (tenant_id, channel, phone_e164)
    values (${tenantId}, 'sms', ${phoneE164})
    on conflict (tenant_id, phone_e164) where channel = 'sms' and phone_e164 is not null
      do update set status = case when public.text_conversations.status = 'closed'
                                   then 'open' else public.text_conversations.status end
    returning id, tenant_id, channel, phone_e164, customer_id, widget_session_token_hash,
              call_log_id, status, structured_state, recent_turns, disclosure_sent,
              verification_phone_e164, verification_code_hash, verification_code_expires_at,
              verification_attempts, message_count, ai_message_count
  `;
  const insertedRow = inserted[0];
  if (!insertedRow) throw new Error("text_conversation_insert_failed");
  return fromDbRow(insertedRow);
}

export interface NewWebChatConversation {
  conversation: TextConversationRow;
  sessionToken: string;
}

/** Web chat: mints a fresh opaque session token (same "token IS the
 * credential" convention as `_shared/dental-intake.ts`'s intake tokens) and
 * a brand-new row — every call to this creates a NEW conversation; callers
 * (api-text-chat) only call this when no valid session token was presented. */
export async function createWebChatConversation(
  sql: SqlClient,
  tenantId: string,
): Promise<NewWebChatConversation> {
  const sessionToken = randomOpaqueToken();
  const tokenHash = await sha256Hex(sessionToken);
  const inserted = await sql<TextConversationDbRow>`
    insert into public.text_conversations (tenant_id, channel, widget_session_token_hash)
    values (${tenantId}, 'web_chat', ${tokenHash})
    returning id, tenant_id, channel, phone_e164, customer_id, widget_session_token_hash,
              call_log_id, status, structured_state, recent_turns, disclosure_sent,
              verification_phone_e164, verification_code_hash, verification_code_expires_at,
              verification_attempts, message_count, ai_message_count
  `;
  const row = inserted[0];
  if (!row) throw new Error("text_conversation_insert_failed");
  return { conversation: fromDbRow(row), sessionToken };
}

export async function loadWebChatConversationByToken(
  sql: SqlClient,
  tenantId: string,
  sessionToken: string,
): Promise<TextConversationRow | null> {
  const tokenHash = await sha256Hex(sessionToken);
  const rows = await sql<TextConversationDbRow>`
    select id, tenant_id, channel, phone_e164, customer_id, widget_session_token_hash,
           call_log_id, status, structured_state, recent_turns, disclosure_sent,
           verification_phone_e164, verification_code_hash, verification_code_expires_at,
           verification_attempts, message_count, ai_message_count
    from public.text_conversations
    where tenant_id = ${tenantId} and channel = 'web_chat' and widget_session_token_hash = ${tokenHash}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  if (row.status === "closed") {
    await sql`update public.text_conversations set status = 'open' where id = ${row.id}`;
    row.status = "open";
  }
  return fromDbRow(row);
}

/**
 * Lazily creates the shadow `call_logs` row a conversation's FIRST tool
 * call needs (see the migration's `call_logs.channel` comment) and caches
 * its id back onto `text_conversations.call_log_id`. Idempotent — a second
 * call for the same conversation just returns the cached id, no new row.
 */
export async function ensureShadowCallLog(
  sql: SqlClient,
  conversation: TextConversationRow,
): Promise<string> {
  if (conversation.callLogId) return conversation.callLogId;

  const retellCallId = `text:${conversation.id}`;
  const rows = await sql<{ id: string }>`
    insert into public.call_logs (tenant_id, retell_call_id, caller_number, channel, direction)
    values (${conversation.tenantId}, ${retellCallId}, ${conversation.phoneE164}, ${conversation.channel}, 'inbound')
    on conflict (retell_call_id) do update set caller_number = excluded.caller_number
    returning id
  `;
  const callLogId = rows[0]?.id;
  if (!callLogId) throw new Error("shadow_call_log_insert_failed");

  await sql`update public.text_conversations set call_log_id = ${callLogId} where id = ${conversation.id}`;
  conversation.callLogId = callLogId;
  return callLogId;
}

export interface ConversationPatch {
  status?: "open" | "human" | "closed";
  structuredState?: Record<string, unknown>;
  appendTurns?: TextTurn[];
  disclosureSent?: boolean;
  phoneE164?: string;
  customerId?: string;
  verificationPhoneE164?: string | null;
  verificationCodeHash?: string | null;
  verificationCodeExpiresAt?: string | null;
  verificationAttempts?: number;
  incrementMessageCount?: boolean;
  incrementAiMessageCount?: boolean;
}

/** Derives the full-transcript `text_conversation_messages.author` from a
 * turn's `role` — the engine only ever writes 'customer' (role 'user') or
 * 'ai' (role 'assistant'); 'human' rows come exclusively from the
 * dashboard's own "take over" reply UI (Cluster W, outside this cluster's
 * write path — see the migration's RLS policy). */
function authorForTurn(turn: TextTurn): "customer" | "ai" {
  return turn.role === "user" ? "customer" : "ai";
}

/**
 * Appends every one of `turns` to the full, unbounded
 * `text_conversation_messages` transcript (20260911130000_text_
 * conversation_messages.sql, docs/audit/CHANNELS_REQUESTS.md item 5) —
 * separate from and in addition to `recent_turns`' bounded working-memory
 * window, which `saveConversationPatch` maintains on the
 * `text_conversations` row itself.
 */
async function recordTranscriptMessages(
  sql: SqlClient,
  tenantId: string,
  conversationId: string,
  turns: TextTurn[],
): Promise<void> {
  for (const turn of turns) {
    await sql`
      insert into public.text_conversation_messages (tenant_id, conversation_id, author, body)
      values (${tenantId}, ${conversationId}, ${authorForTurn(turn)}, ${turn.text})
    `;
  }
}

/** Persists the engine's per-turn state changes. `appendTurns` merges onto
 * `recent_turns`, trimmed to `MAX_REPLAYED_TURNS` — the trim happens here
 * (not by the caller) so every write site gets the bound for free — AND is
 * recorded, untrimmed, onto the full `text_conversation_messages`
 * transcript (`recordTranscriptMessages` above). */
export async function saveConversationPatch(
  sql: SqlClient,
  conversation: TextConversationRow,
  patch: ConversationPatch,
): Promise<void> {
  if (patch.appendTurns && patch.appendTurns.length > 0) {
    await recordTranscriptMessages(sql, conversation.tenantId, conversation.id, patch.appendTurns);
  }

  const nextTurns = patch.appendTurns
    ? [...conversation.recentTurns, ...patch.appendTurns].slice(-MAX_REPLAYED_TURNS)
    : conversation.recentTurns;

  const nextMessageCount = conversation.messageCount + (patch.incrementMessageCount ? 1 : 0);
  const nextAiMessageCount = conversation.aiMessageCount + (patch.incrementAiMessageCount ? 1 : 0);

  await sql`
    update public.text_conversations set
      status = ${patch.status ?? conversation.status},
      structured_state = ${patch.structuredState ?? conversation.structuredState}::jsonb,
      recent_turns = ${nextTurns}::jsonb,
      disclosure_sent = ${patch.disclosureSent ?? conversation.disclosureSent},
      phone_e164 = ${patch.phoneE164 ?? conversation.phoneE164},
      customer_id = ${patch.customerId ?? conversation.customerId},
      verification_phone_e164 = ${
        patch.verificationPhoneE164 !== undefined
          ? patch.verificationPhoneE164
          : conversation.verificationPhoneE164
      },
      verification_code_hash = ${
        patch.verificationCodeHash !== undefined
          ? patch.verificationCodeHash
          : conversation.verificationCodeHash
      },
      verification_code_expires_at = ${
        patch.verificationCodeExpiresAt !== undefined
          ? patch.verificationCodeExpiresAt
          : conversation.verificationCodeExpiresAt
      }::timestamptz,
      verification_attempts = ${patch.verificationAttempts ?? conversation.verificationAttempts},
      message_count = ${nextMessageCount},
      ai_message_count = ${nextAiMessageCount},
      last_inbound_at = now(),
      last_outbound_at = case when ${!!patch.incrementAiMessageCount} then now() else last_outbound_at end
    where id = ${conversation.id}
  `;

  conversation.status = patch.status ?? conversation.status;
  conversation.structuredState = patch.structuredState ?? conversation.structuredState;
  conversation.recentTurns = nextTurns;
  conversation.disclosureSent = patch.disclosureSent ?? conversation.disclosureSent;
  conversation.phoneE164 = patch.phoneE164 ?? conversation.phoneE164;
  conversation.customerId = patch.customerId ?? conversation.customerId;
  if (patch.verificationPhoneE164 !== undefined)
    conversation.verificationPhoneE164 = patch.verificationPhoneE164;
  if (patch.verificationCodeHash !== undefined)
    conversation.verificationCodeHash = patch.verificationCodeHash;
  if (patch.verificationCodeExpiresAt !== undefined)
    conversation.verificationCodeExpiresAt = patch.verificationCodeExpiresAt;
  if (patch.verificationAttempts !== undefined)
    conversation.verificationAttempts = patch.verificationAttempts;
  conversation.messageCount = nextMessageCount;
  conversation.aiMessageCount = nextAiMessageCount;
}

interface TenantTextContextRow {
  business_name: string;
  vertical: string;
  timezone: string;
  a2p_status: string;
  assistant_name: string | null;
  transfer_number: string | null;
  dynamic_variable_overrides: Record<string, unknown>;
  disclosure_line: string | null;
  price_version: string;
}

/** Resolves the same tenant/agent-config shape `voice-inbound/handler.ts`
 * resolves for a call (BACKEND_SPEC §7.1's own indexed join), reused here
 * unmodified rather than re-deriving a second, possibly-drifting query. */
export async function resolveTenantTextContext(
  sql: SqlClient,
  tenantId: string,
): Promise<TenantTextContext | null> {
  const rows = await sql<TenantTextContextRow>`
    select
      t.name as business_name,
      t.vertical,
      t.timezone,
      t.a2p_status,
      ac.assistant_name,
      ac.transfer_number,
      ac.dynamic_variable_overrides,
      at.disclosure_line,
      t.price_version
    from public.tenants t
    left join public.agent_configs ac on ac.tenant_id = t.id
    left join public.agent_templates at on at.id = ac.template_id
    where t.id = ${tenantId}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;

  const overrides = row.dynamic_variable_overrides ?? {};
  const policy =
    overrides["cancellation_policy"] &&
    typeof overrides["cancellation_policy"] === "object" &&
    !Array.isArray(overrides["cancellation_policy"])
      ? (overrides["cancellation_policy"] as Record<string, unknown>)
      : undefined;
  const cancellationPolicyText =
    typeof policy?.["text"] === "string" && policy["text"].trim().length > 0
      ? (policy["text"] as string)
      : "we ask that you let us know as soon as possible if you need to cancel or reschedule";

  return {
    tenantId,
    businessName: row.business_name,
    assistantName: row.assistant_name ?? "the AI assistant",
    vertical: row.vertical,
    timezone: row.timezone,
    transferNumber: row.transfer_number,
    a2pStatus: row.a2p_status,
    disclosureLine: row.disclosure_line ?? "",
    cancellationPolicyText,
    dynamicVariableOverrides: overrides,
    priceVersion: row.price_version,
  };
}

/** MASTER_SPEC §3.3: `messages_outbound` checks `sms_opt_out` before every
 * send; the text engine applies the same check before generating a reply
 * for the SMS channel (an opted-out customer's later, non-STOP message
 * must still never receive an AI reply until they text START again). */
export async function isSmsOptedOut(
  sql: SqlClient,
  tenantId: string,
  phoneE164: string,
): Promise<boolean> {
  const rows = await sql<{ sms_opt_out: boolean }>`
    select sms_opt_out from public.customers
    where tenant_id = ${tenantId} and phone_e164 = ${phoneE164}
    limit 1
  `;
  return rows[0]?.sms_opt_out ?? false;
}

export async function incrementTextMessagesOut(
  sql: SqlClient,
  tenantId: string,
  priceVersion: string,
): Promise<void> {
  await sql`
    insert into public.usage_daily (tenant_id, date, price_version, text_messages_out)
    values (${tenantId}, current_date, ${priceVersion}, 1)
    on conflict (tenant_id, date)
      do update set text_messages_out = public.usage_daily.text_messages_out + 1
  `;
}
