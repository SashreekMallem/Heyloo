/**
 * `SquareProvider implements IntegrationAdapter` — the ONLY thing this
 * package exports for use outside itself, mirroring
 * `packages/adapters/retell/src/provider.ts`'s shape (CLAUDE.md Rule 2:
 * every method takes/returns canonical types from `./adapter-types.js`,
 * never a raw Square payload).
 */

import type {
  AdapterCapabilities,
  AdapterConnectionCredentials,
  CheckAvailabilityParams,
  CheckAvailabilityResult,
  HandleWebhookParams,
  HandleWebhookResult,
  IntegrationAdapter,
  PushBookingParams,
  PushBookingResult,
  PushOrderParams,
  PushOrderResult,
  RefreshAuthResult,
  SyncCatalogResult,
} from "./adapter-types.js";
import { refreshSquareAuth, type SquareAuthOptions } from "./auth.js";
import { checkSquareAvailability } from "./availability.js";
import { pushSquareBooking, pushSquareOrder } from "./booking.js";
import { syncSquareCatalog } from "./catalog.js";
import { SquareClient, type SquareClientOptions } from "./client.js";
import { normalizeSquareWebhook, verifySquareWebhookSignature } from "./webhook.js";

export const SQUARE_CAPABILITIES: AdapterCapabilities = {
  supportsCatalogSync: true,
  supportsAvailabilityCheck: true,
  supportsBookingPush: true,
  supportsOrderPush: true,
  supportsChangeWebhooks: true,
  authMode: "oauth2_authorization_code",
};

export interface SquareProviderOptions extends SquareClientOptions, SquareAuthOptions {
  /** The exact URL Square's Developer Console has on file for this
   * subscription — required verbatim in the webhook signature calculation
   * (`HMAC-SHA256(notificationUrl + rawBody)`). */
  webhookNotificationUrl: string;
  webhookSignatureKey: string;
}

export class SquareProvider implements IntegrationAdapter {
  readonly name = "square";
  readonly capabilities = SQUARE_CAPABILITIES;

  private readonly client: SquareClient;
  private readonly authOptions: SquareAuthOptions;
  private readonly webhookNotificationUrl: string;
  private readonly webhookSignatureKey: string;

  constructor(options: SquareProviderOptions) {
    this.client = new SquareClient(options);
    this.authOptions = { clientId: options.clientId, clientSecret: options.clientSecret };
    this.webhookNotificationUrl = options.webhookNotificationUrl;
    this.webhookSignatureKey = options.webhookSignatureKey;
  }

  async syncCatalog(connection: AdapterConnectionCredentials): Promise<SyncCatalogResult> {
    const locationId = connection.metadata?.["locationId"];
    return syncSquareCatalog(this.client, connection.accessToken ?? "", {
      locationIds: typeof locationId === "string" ? [locationId] : undefined,
    });
  }

  async checkAvailability(
    connection: AdapterConnectionCredentials,
    params: CheckAvailabilityParams,
  ): Promise<CheckAvailabilityResult> {
    return checkSquareAvailability(this.client, connection, params);
  }

  async pushBooking(
    connection: AdapterConnectionCredentials,
    params: PushBookingParams,
  ): Promise<PushBookingResult> {
    return pushSquareBooking(this.client, connection, params);
  }

  async pushOrder(
    connection: AdapterConnectionCredentials,
    params: PushOrderParams,
  ): Promise<PushOrderResult> {
    return pushSquareOrder(this.client, connection, params);
  }

  async handleWebhook(params: HandleWebhookParams): Promise<HandleWebhookResult> {
    const signatureHeader =
      params.headers["x-square-hmacsha256-signature"] ??
      params.headers["X-Square-Hmacsha256-Signature"];
    const verification = verifySquareWebhookSignature({
      rawBody: params.rawBody,
      signatureHeader,
      notificationUrl: this.webhookNotificationUrl,
      signatureKey: this.webhookSignatureKey,
    });
    if (!verification.valid) {
      return { valid: false, reason: verification.reason };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(params.rawBody);
    } catch {
      return { valid: false, reason: "invalid_json" };
    }
    return { valid: true, event: normalizeSquareWebhook(parsed) };
  }

  async refreshAuth(connection: AdapterConnectionCredentials): Promise<RefreshAuthResult> {
    return refreshSquareAuth(this.client, this.authOptions, connection);
  }
}
