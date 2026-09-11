/**
 * Portable shared types for the text-agent engine (Cluster T). Same
 * "dependency-free, Deno/Node-portable" convention as `_shared/types.ts`
 * (see that file's own docstring) — every file in `_shared/text-agent/**`
 * that imports only from here can be typechecked/unit-tested under
 * Node/Vitest exactly as it runs under Deno at deploy time.
 */

export const TEXT_CHANNELS = ["sms", "web_chat"] as const;
export type TextChannel = (typeof TEXT_CHANNELS)[number];

export type TextConversationStatus = "open" | "human" | "closed";

/** One turn of the compact, bounded recent-turn window persisted on
 * `text_conversations.recent_turns` and replayed to the model each call —
 * NOT the full audit trail (that stays in messages_inbound/messages_outbound
 * as an append-only log; this is the engine's own working memory, kept
 * short deliberately: "do not resend the whole history each turn beyond N
 * messages; summarize" per this task's own instruction). */
export interface TextTurn {
  role: "user" | "assistant";
  text: string;
  at: string; // ISO timestamp
}

export interface TextConversationRow {
  id: string;
  tenantId: string;
  channel: TextChannel;
  phoneE164: string | null;
  customerId: string | null;
  widgetSessionTokenHash: string | null;
  callLogId: string | null;
  status: TextConversationStatus;
  structuredState: Record<string, unknown>;
  recentTurns: TextTurn[];
  disclosureSent: boolean;
  verificationPhoneE164: string | null;
  verificationCodeHash: string | null;
  verificationCodeExpiresAt: string | null;
  verificationAttempts: number;
  messageCount: number;
  aiMessageCount: number;
}

export interface TenantTextContext {
  tenantId: string;
  businessName: string;
  assistantName: string;
  vertical: string;
  timezone: string;
  transferNumber: string | null;
  a2pStatus: string;
  disclosureLine: string;
  cancellationPolicyText: string;
  dynamicVariableOverrides: Record<string, unknown>;
  /** `tenants.price_version` (defaults `'v1'`) — the real per-tenant price
   * version, threaded through to `incrementTextMessagesOut` so a tenant
   * later migrated off `'v1'` doesn't get its `usage_daily.price_version`
   * silently mis-recorded on the first message of the day. */
  priceVersion: string;
}

/** The engine's result for one inbound message — the caller (webhooks-
 * twilio-sms for SMS, api-text-chat for web_chat) decides how to deliver
 * `reply` (TwiML body vs. JSON response) but never generates the text
 * itself. `sent` is false whenever the engine deliberately produced no
 * reply (human handoff active, A2P not verified, rate-limited, opted out,
 * closed conversation) — never a bare thrown error, matching the rest of
 * this codebase's graceful-fallback discipline (`_shared/responses.ts`). */
export interface TextAgentTurnResult {
  conversationId: string;
  reply: string | null;
  sent: boolean;
  reason?:
    | "human_handoff"
    | "a2p_not_verified"
    | "opted_out"
    | "rate_limited"
    | "closed"
    | "engine_error"
    | "verification_pending";
  /** Web chat only: the opaque session token the client must present on
   * every subsequent turn — set only on the turn that created the row. */
  widgetSessionToken?: string;
}
