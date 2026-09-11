import { z } from "zod";

/**
 * `/api-text-chat` request/response contract (Cluster T — the web widget's
 * chat mode). Public endpoint (no Supabase JWT, `verify_jwt = false` in
 * supabase/config.toml) called DIRECTLY from an arbitrary tenant's own
 * website (cross-origin, no `apps/web` proxy) — this exact shape is
 * `docs/audit/CHANNELS_REQUESTS.md` item 4, posted by Cluster W (the
 * widget) and already built against by `packages/widget/src/api.ts`'s
 * `sendChatMessage` and `packages/widget/src/types.ts`'s
 * `WidgetChatResponse`/`WidgetErrorResponse` — this schema/response type
 * mirrors those verbatim rather than inventing a second contract.
 *
 * `tenant_id` is NEVER a client-supplied field (CLAUDE.md Rule 2) — it is
 * resolved server-side from the verified `widget_token` (see
 * `_shared/widget-token.ts`), which `apps/web`'s `POST /api/widget/session`
 * mints only after checking the request Origin against
 * `tenants.widget_settings.allowed_origins` and the presented
 * `widget_public_key` against `tenants.widget_public_key`.
 */
export const TextChatRequestSchema = z.object({
  widget_token: z.string().min(1),
  message: z.string().min(1).max(2000),
  /** `handleInboundText`'s own `WebChatTurnInput.sessionToken` — omitted
   * on the first turn; the widget echoes it back verbatim afterward. */
  conversation_token: z.string().min(1).optional(),
});
export type TextChatRequest = z.infer<typeof TextChatRequestSchema>;

export interface TextChatResponse {
  conversation_token: string;
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
}

export interface TextChatErrorResponse {
  error: "invalid_widget_token" | "expired_widget_token" | "invalid_request" | "text_chat_failed";
}
