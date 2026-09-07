/**
 * The `IntegrationAdapter` interface (MASTER_PLAN §1, BACKEND_SPEC §7.6,
 * API_AND_FLOWS.md A.6): the shared contract every deep-integration/POS/PMS
 * adapter implements — `syncCatalog`, `pushBooking`/`pushOrder`,
 * `checkAvailability` (where the platform supports it), `handleWebhook`,
 * `refreshAuth`, plus two-way sync pull-back and `auth_revoked` handling.
 *
 * INTENTIONAL DUPLICATION (documented per CLAUDE.md Rule 4, mirroring T4's
 * own precedent for `_shared/compiler/template-compiler.ts` duplicating
 * `packages/adapters/retell/src/compiler/*`): this file is byte-for-byte
 * identical across `packages/adapters/{shopmonkey,ezyvet,google-calendar,
 * square}` rather than living in one shared package. Two reasons, both
 * scope-driven rather than accidental: (1) this task's assignment lists
 * these four directories as the *exclusive* paths it may touch — creating a
 * fifth `packages/adapters/pos-shared` package (or editing
 * `packages/canonical-types`, T2's package) would be working outside that
 * boundary; (2) `@heyloo/canonical-types` only defines `VoiceProvider`
 * today (T2 scope) — adding `IntegrationAdapter` there is the natural home
 * once a task owns that package again, flagged in `docs/BUILD_NOTES.md`'s
 * T7 entry as a named follow-up to de-duplicate. Every consuming call site
 * (webhooks-pos, worker-adapter-push, api-adapter-connect) depends only on
 * these shapes, never on a provider-specific payload (CLAUDE.md Rule 2).
 */

// ---------------------------------------------------------------------------
// Capabilities — what THIS adapter can actually do; core code branches on
// these instead of hardcoding per-provider assumptions (mirrors
// ProviderCapabilities in @heyloo/canonical-types' voice-provider.ts).
// ---------------------------------------------------------------------------

export const ADAPTER_AUTH_MODES = [
  "oauth2_authorization_code",
  "oauth2_client_credentials",
  "oauth2_password",
  "api_key",
] as const;
export type AdapterAuthMode = (typeof ADAPTER_AUTH_MODES)[number];

export interface AdapterCapabilities {
  readonly supportsCatalogSync: boolean;
  readonly supportsAvailabilityCheck: boolean;
  readonly supportsBookingPush: boolean;
  readonly supportsOrderPush: boolean;
  /** True when the provider delivers real-time webhooks for staff-made
   * changes; false means two-way sync relies on `pullChanges` polling
   * (BACKEND_SPEC §7.6 "Two-way sync behavior (G11)" column). */
  readonly supportsChangeWebhooks: boolean;
  readonly authMode: AdapterAuthMode;
}

// ---------------------------------------------------------------------------
// Connection credentials — the shape persisted (encrypted at rest by the
// caller) in the `adapter_connections` table and threaded into every method.
// ---------------------------------------------------------------------------

export interface AdapterConnectionCredentials {
  /** OAuth2 access token, or the bare API key for `api_key` auth mode. */
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  /** ISO timestamp the access token expires at (OAuth adapters only). */
  expiresAt?: string | undefined;
  /** Provider account/merchant/practice id resolved at connect time. */
  providerAccountId?: string | undefined;
  /** Provider-specific extras a given adapter needs (e.g. ezyVet's
   * `partner_id`, Shopmonkey's shop id, Square's `location_id`, a Google
   * Calendar `calendarId`) — never inspected outside this adapter package. */
  metadata?: Record<string, unknown> | undefined;
}

// ---------------------------------------------------------------------------
// Catalog sync
// ---------------------------------------------------------------------------

export interface CanonicalCatalogItem {
  externalId: string;
  name: string;
  category?: string | undefined;
  durationMinutes?: number | undefined;
  priceCents?: number | undefined;
  active: boolean;
  raw?: unknown | undefined;
}

export interface SyncCatalogResult {
  items: CanonicalCatalogItem[];
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export interface CheckAvailabilityParams {
  startAt: string;
  endAt: string;
  resourceExternalId?: string | undefined;
}

export interface CanonicalAvailabilitySlot {
  startAt: string;
  endAt: string;
  resourceExternalId?: string | undefined;
}

export interface CheckAvailabilityResult {
  slots: CanonicalAvailabilitySlot[];
}

// ---------------------------------------------------------------------------
// Booking / order push (BACKEND_SPEC §7.6 "pushBooking/pushOrder calls carry
// the same idempotency_key used internally so a retried push doesn't create
// a duplicate")
// ---------------------------------------------------------------------------

export interface PushBookingParams {
  idempotencyKey: string;
  startAt: string;
  endAt: string;
  customerName: string;
  customerPhoneE164: string;
  customerEmail?: string | undefined;
  serviceExternalId?: string | undefined;
  resourceExternalId?: string | undefined;
  notes?: string | undefined;
  partySize?: number | undefined;
}

export interface PushBookingResult {
  externalId: string;
  status: "confirmed" | "pending";
  /** True when this call found an existing push for the same idempotency
   * key rather than creating a new one (conflict-safe replay). */
  deduped: boolean;
  raw?: unknown | undefined;
}

export interface PushOrderLineItem {
  name: string;
  qty: number;
  unitPriceCents: number;
  modifiers?: string[] | undefined;
}

export interface PushOrderParams {
  idempotencyKey: string;
  items: PushOrderLineItem[];
  fulfillmentType: "pickup" | "delivery" | "dine_in";
  totalCents: number;
  customerName?: string | undefined;
  customerPhoneE164?: string | undefined;
  deliveryAddress?: Record<string, unknown> | undefined;
}

export interface PushOrderResult {
  externalId: string;
  deduped: boolean;
  raw?: unknown | undefined;
}

// ---------------------------------------------------------------------------
// Webhooks + two-way sync (BACKEND_SPEC §7.6 "Shared side effects across all
// adapters": normalize into `{type, external_id, changes}`; `auth_revoked`
// marks the connection disconnected and fires a dashboard banner)
// ---------------------------------------------------------------------------

export const CANONICAL_ADAPTER_EVENT_TYPES = [
  "booking_changed",
  "order_changed",
  "auth_revoked",
  "unknown",
] as const;
export type CanonicalAdapterEventType = (typeof CANONICAL_ADAPTER_EVENT_TYPES)[number];

export interface CanonicalAdapterEvent {
  type: CanonicalAdapterEventType;
  externalId: string | null;
  changes: Record<string, unknown>;
}

export interface HandleWebhookParams {
  rawBody: string;
  headers: Record<string, string | null>;
  connection: AdapterConnectionCredentials;
}

export type HandleWebhookResult =
  | { valid: true; event: CanonicalAdapterEvent }
  | { valid: false; reason: string };

/** Poll-based two-way sync fallback (G11) for providers with no (or
 * unconfirmed) webhook coverage for staff-made changes — see BACKEND_SPEC
 * §7.6's per-adapter "poll-back on a schedule" column. */
export interface PullChangesParams {
  connection: AdapterConnectionCredentials;
  /** ISO timestamp of the last successful poll; omitted on first run. */
  since?: string | undefined;
}

export interface PullChangesResult {
  events: CanonicalAdapterEvent[];
  /** Opaque cursor/timestamp to persist and pass as `since` next poll. */
  cursor: string;
}

// ---------------------------------------------------------------------------
// Auth refresh
// ---------------------------------------------------------------------------

export interface RefreshAuthResult {
  credentials: AdapterConnectionCredentials;
  /** True when the provider reports the grant itself was revoked (never a
   * transient failure) — the caller marks the connection `disconnected`
   * and fires the dashboard banner (salvaged pattern, SYSTEM_DESIGN §14). */
  revoked: boolean;
}

// ---------------------------------------------------------------------------
// The interface itself. `checkAvailability`/`pushBooking`/`pushOrder`/
// `pullChanges` are optional — not every adapter supports every operation
// (Shopmonkey has no confirmed availability read; Google Calendar has no
// "order"; a webhook-only adapter never needs `pullChanges`) — callers
// branch on `capabilities` before calling, never assume a method exists.
// ---------------------------------------------------------------------------

export interface IntegrationAdapter {
  readonly name: string;
  readonly capabilities: AdapterCapabilities;

  syncCatalog(connection: AdapterConnectionCredentials): Promise<SyncCatalogResult>;
  checkAvailability?(
    connection: AdapterConnectionCredentials,
    params: CheckAvailabilityParams,
  ): Promise<CheckAvailabilityResult>;
  pushBooking?(
    connection: AdapterConnectionCredentials,
    params: PushBookingParams,
  ): Promise<PushBookingResult>;
  pushOrder?(
    connection: AdapterConnectionCredentials,
    params: PushOrderParams,
  ): Promise<PushOrderResult>;
  handleWebhook(params: HandleWebhookParams): Promise<HandleWebhookResult>;
  pullChanges?(params: PullChangesParams): Promise<PullChangesResult>;
  refreshAuth(connection: AdapterConnectionCredentials): Promise<RefreshAuthResult>;
}
