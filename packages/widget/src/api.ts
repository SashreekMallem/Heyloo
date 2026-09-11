import type {
  WidgetChatResponse,
  WidgetConfig,
  WidgetErrorResponse,
  WidgetSessionResponse,
  WidgetVoiceTokenResponse,
} from "./types.js";

/**
 * Every request here uses `.then()` chains, never `async`/`await` —
 * `tsup.config.ts` targets `es5` for this package's output (ownership
 * brief: "ES5-safe IIFE"), and esbuild's ES5 downlevel target cannot lower
 * `async`/`await` syntax at all (it requires a generator-based runtime
 * helper ES5 doesn't have) — using it here would make the build itself
 * fail, not just silently ship non-ES5 output.
 */

function parseJson<T>(res: Response): Promise<T> {
  return res.json().catch(() => ({}) as T);
}

export function fetchConfig(
  configEndpoint: string,
  widgetPublicKey: string,
): Promise<WidgetConfig | null> {
  const url = `${configEndpoint}?key=${encodeURIComponent(widgetPublicKey)}`;
  return fetch(url, { method: "GET" })
    .then((res) => {
      if (!res.ok) return null;
      return parseJson<WidgetConfig>(res);
    })
    .catch(() => null);
}

export function mintSession(
  sessionEndpoint: string,
  widgetPublicKey: string,
): Promise<WidgetSessionResponse | null> {
  return fetch(sessionEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ widget_public_key: widgetPublicKey }),
  })
    .then((res) => {
      if (!res.ok) return null;
      return parseJson<WidgetSessionResponse>(res);
    })
    .catch(() => null);
}

export function fetchVoiceToken(
  voiceTokenEndpoint: string,
  widgetToken: string,
): Promise<WidgetVoiceTokenResponse | WidgetErrorResponse> {
  return fetch(voiceTokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ widget_token: widgetToken }),
  })
    .then((res) => parseJson<WidgetVoiceTokenResponse | WidgetErrorResponse>(res))
    .catch(() => ({ error: "network_error" }));
}

/** Calls `api-text-chat` (Cluster T) directly, cross-origin, per
 * docs/audit/CHANNELS_REQUESTS.md item 4. */
export function sendChatMessage(
  chatEndpoint: string,
  widgetToken: string,
  message: string,
  conversationToken: string | null,
): Promise<WidgetChatResponse | WidgetErrorResponse> {
  const body: Record<string, unknown> = { widget_token: widgetToken, message: message };
  if (conversationToken) body["conversation_token"] = conversationToken;
  return fetch(chatEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
    .then((res) => parseJson<WidgetChatResponse | WidgetErrorResponse>(res))
    .catch(() => ({ error: "network_error" }));
}

export function isErrorResponse(value: unknown): value is WidgetErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { error?: unknown }).error === "string"
  );
}
