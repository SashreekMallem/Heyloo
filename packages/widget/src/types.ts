/**
 * Wire types for the widget (BUILD_PLAN Cluster W). Deliberately duplicated
 * rather than imported from `@heyloo/canonical-types` — this package ships
 * as a single standalone `<script>` bundle loaded on an arbitrary
 * third-party page (no access to the rest of the monorepo's build graph at
 * runtime), so every type it needs must live inside its own `src/`.
 */

export type WidgetPosition = "bottom-right" | "bottom-left";
export type WidgetMode = "voice" | "chat";

/** `GET /api/widget/config` response (apps/web, origin+key gated). */
export interface WidgetConfig {
  business_name: string;
  accent: string | null;
  position: WidgetPosition;
  greeting: string | null;
  modes: WidgetMode[];
  /** Absolute URL of the widget's own `POST /api/widget/session` route
   * (same origin the config was fetched from — kept explicit rather than
   * re-derived from `location`, since this script's own origin at runtime
   * IS the third-party page, not `apps.heyloo.*`). */
  session_endpoint: string;
  voice_token_endpoint: string;
  /** Absolute Supabase Functions URL for `api-text-chat`
   * (docs/audit/CHANNELS_REQUESTS.md item 4) — computed server-side so
   * this script never hardcodes an environment-specific host. */
  chat_endpoint: string;
  /** Absolute URL of the lazy-loaded voice runtime chunk (bundles
   * `retell-client-js-sdk`) — fetched only when a visitor opens Voice
   * mode, never on initial widget load (keeps the always-loaded IIFE
   * under the 25KB gz budget). */
  voice_runtime_url: string;
}

/** `POST /api/widget/session` response. */
export interface WidgetSessionResponse {
  widget_token: string;
  expires_at: string;
}

/** `POST /api/widget/voice-token` response. */
export interface WidgetVoiceTokenResponse {
  access_token: string;
  call_id: string;
}

/** `POST {chat_endpoint}` (api-text-chat) response — see
 * docs/audit/CHANNELS_REQUESTS.md item 4 for the full contract. */
export interface WidgetChatResponse {
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

export interface WidgetErrorResponse {
  error: string;
}

/** Injected via `data-preview-config` (JSON) by the tenant dashboard's
 * Install page live preview (`dashboard/website-widget`) so the visual
 * chrome can be previewed WITHOUT the origin-allowlist network round trip
 * (the dashboard's own origin is never itself an allowed embed origin) —
 * see that route's own docstring. Preview mode never sends a real
 * voice/chat request. */
export interface WidgetPreviewConfig {
  business_name: string;
  accent: string | null;
  position: WidgetPosition;
  greeting: string | null;
  modes: WidgetMode[];
}
