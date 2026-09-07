/**
 * `GoogleCalendarProvider implements IntegrationAdapter` — SYSTEM_DESIGN's
 * "explicitly the fallback-mode universal option" (G10), so the most
 * universally-connectable adapter of the four (works for any tenant with a
 * Google account, not just a specific vertical's PMS).
 */

import type {
  AdapterCapabilities,
  AdapterConnectionCredentials,
  CheckAvailabilityParams,
  CheckAvailabilityResult,
  HandleWebhookParams,
  HandleWebhookResult,
  IntegrationAdapter,
  PullChangesParams,
  PullChangesResult,
  PushBookingParams,
  PushBookingResult,
  RefreshAuthResult,
  SyncCatalogResult,
} from "./adapter-types.js";
import { type GoogleCalendarAuthOptions, refreshGoogleCalendarAuth } from "./auth.js";
import { checkGoogleCalendarAvailability } from "./availability.js";
import { pushGoogleCalendarBooking } from "./booking.js";
import { syncGoogleCalendarCatalog } from "./catalog.js";
import { GoogleCalendarClient, type GoogleCalendarClientOptions } from "./client.js";
import { pullGoogleCalendarChanges } from "./sync.js";
import {
  normalizeGoogleCalendarNotification,
  verifyGoogleCalendarNotification,
} from "./webhook.js";

export const GOOGLE_CALENDAR_CAPABILITIES: AdapterCapabilities = {
  supportsCatalogSync: true,
  supportsAvailabilityCheck: true,
  supportsBookingPush: true,
  supportsOrderPush: false,
  supportsChangeWebhooks: true,
  authMode: "oauth2_authorization_code",
};

export interface GoogleCalendarProviderOptions
  extends GoogleCalendarClientOptions,
    GoogleCalendarAuthOptions {
  /** The shared secret (`clientState`/`token`) set when registering a
   * watch channel for a given connection — echoed back on every
   * notification as `X-Goog-Channel-Token` (fail-closed verification). */
  resolveChannelToken: (connection: AdapterConnectionCredentials) => string | undefined;
}

export class GoogleCalendarProvider implements IntegrationAdapter {
  readonly name = "google-calendar";
  readonly capabilities = GOOGLE_CALENDAR_CAPABILITIES;

  private readonly client: GoogleCalendarClient;
  private readonly authOptions: GoogleCalendarAuthOptions;
  private readonly resolveChannelToken: (
    connection: AdapterConnectionCredentials,
  ) => string | undefined;

  constructor(options: GoogleCalendarProviderOptions) {
    this.client = new GoogleCalendarClient(options);
    this.authOptions = { clientId: options.clientId, clientSecret: options.clientSecret };
    this.resolveChannelToken = options.resolveChannelToken;
  }

  async syncCatalog(connection: AdapterConnectionCredentials): Promise<SyncCatalogResult> {
    return syncGoogleCalendarCatalog(this.client, connection.accessToken ?? "");
  }

  async checkAvailability(
    connection: AdapterConnectionCredentials,
    params: CheckAvailabilityParams,
  ): Promise<CheckAvailabilityResult> {
    return checkGoogleCalendarAvailability(this.client, connection, params);
  }

  async pushBooking(
    connection: AdapterConnectionCredentials,
    params: PushBookingParams,
  ): Promise<PushBookingResult> {
    return pushGoogleCalendarBooking(this.client, connection, params);
  }

  async handleWebhook(params: HandleWebhookParams): Promise<HandleWebhookResult> {
    const verification = verifyGoogleCalendarNotification({
      headers: params.headers,
      expectedChannelToken: this.resolveChannelToken(params.connection),
    });
    if (!verification.valid) return { valid: false, reason: verification.reason };
    return { valid: true, event: normalizeGoogleCalendarNotification(verification.headers) };
  }

  async pullChanges(params: PullChangesParams): Promise<PullChangesResult> {
    return pullGoogleCalendarChanges(this.client, params);
  }

  async refreshAuth(connection: AdapterConnectionCredentials): Promise<RefreshAuthResult> {
    return refreshGoogleCalendarAuth(this.client, this.authOptions, connection);
  }
}
