import { sha256Hex } from "../_shared/crypto.ts";
import type { TextAgentDeps } from "../_shared/text-agent/engine.ts";
import { handleInboundText } from "../_shared/text-agent/engine.ts";
import type { Logger } from "../_shared/types.ts";
// Shared verifier for the embeddable widget's session token
// (`_shared/widget-token.ts`, built alongside `api-widget-voice-token` —
// that file's own docstring names `api-text-chat` as its other intended
// consumer, so this reuses it directly rather than maintaining a second
// copy of the same security-critical HMAC-verification logic).
import { verifyWidgetToken } from "../_shared/widget-token.ts";
import type { TextChatErrorResponse, TextChatRequest, TextChatResponse } from "./schema.ts";

export type TextChatResult =
  | { status: 200; body: TextChatResponse }
  | { status: 401; body: TextChatErrorResponse }
  | { status: 500; body: TextChatErrorResponse };

/**
 * `/api-text-chat` core logic (Cluster T — the web widget's chat mode
 * calling into the SAME text-agent engine `webhooks-twilio-sms` uses for
 * SMS; contract per docs/audit/CHANNELS_REQUESTS.md item 4). Pure/DB-
 * injected, unit testable without Deno — the Deno `index.ts` in this
 * directory only does JSON parsing + schema validation + CORS + calling
 * this, mirroring every other `api-*` function's Deno/Node split.
 */
export async function handleTextChat(
  deps: TextAgentDeps & { widgetTokenSecret: string },
  logger: Logger,
  body: TextChatRequest,
): Promise<TextChatResult> {
  const verification = await verifyWidgetToken(body.widget_token, deps.widgetTokenSecret);
  if (!verification.ok) {
    return {
      status: 401,
      body: {
        error: verification.reason === "expired" ? "expired_widget_token" : "invalid_widget_token",
      },
    };
  }

  try {
    // Keys the engine's rate limiter on the caller's `widget_token` rather
    // than the (possibly brand-new-every-request) conversation id — see
    // `WebChatTurnInput.sessionKey`'s docstring. The token is already the
    // thing this endpoint trusts as the caller's identity for its full TTL,
    // so hashing it here (never logging/storing the raw token) gives a
    // stable per-browser-session limiter key even when `conversation_token`
    // is omitted on every request.
    const sessionKey = `widget_token:${await sha256Hex(body.widget_token)}`;
    const result = await handleInboundText(deps, {
      channel: "web_chat",
      tenantId: verification.payload.tenant_id,
      ...(body.conversation_token ? { sessionToken: body.conversation_token } : {}),
      message: body.message,
      sessionKey,
    });

    return {
      status: 200,
      body: {
        // Always non-empty: either the fresh token the engine just minted
        // (first turn / an unrecognized incoming one) or the same valid
        // one the widget already presented (schema.ts's own docstring).
        conversation_token: result.widgetSessionToken ?? body.conversation_token ?? "",
        reply: result.reply,
        sent: result.sent,
        ...(result.reason ? { reason: result.reason } : {}),
      },
    };
  } catch (err) {
    logger.error("api_text_chat_failed", {
      tenant_id: verification.payload.tenant_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 500, body: { error: "text_chat_failed" } };
  }
}
