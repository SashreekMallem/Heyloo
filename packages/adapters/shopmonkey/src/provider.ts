/**
 * `ShopmonkeyProvider implements IntegrationAdapter`. `checkAvailability`
 * is intentionally NOT implemented — API_AND_FLOWS.md A.6 lists "read shop
 * schedule" as a call this adapter should make but flags the exact 2.0
 * endpoint as TBD; `capabilities.supportsAvailabilityCheck: false` signals
 * callers to skip straight to the primary-tier (Heyloo-owned
 * `availability_slots`) quote path for this adapter rather than guess an
 * endpoint shape with zero corroboration.
 */

import type {
  AdapterCapabilities,
  AdapterConnectionCredentials,
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
import { refreshShopmonkeyAuth } from "./auth.js";
import { pushShopmonkeyBooking } from "./booking.js";
import { syncShopmonkeyCatalog } from "./catalog.js";
import { ShopmonkeyClient, type ShopmonkeyClientOptions } from "./client.js";
import { pullShopmonkeyChanges } from "./sync.js";
import { normalizeShopmonkeyWebhook, verifyShopmonkeyWebhookSignature } from "./webhook.js";

export const SHOPMONKEY_CAPABILITIES: AdapterCapabilities = {
  supportsCatalogSync: true,
  supportsAvailabilityCheck: false,
  supportsBookingPush: true,
  supportsOrderPush: false,
  supportsChangeWebhooks: true,
  authMode: "api_key",
};

export interface ShopmonkeyProviderOptions extends ShopmonkeyClientOptions {
  webhookSigningSecret: string;
}

export class ShopmonkeyProvider implements IntegrationAdapter {
  readonly name = "shopmonkey";
  readonly capabilities = SHOPMONKEY_CAPABILITIES;

  private readonly client: ShopmonkeyClient;
  private readonly webhookSigningSecret: string;

  constructor(options: ShopmonkeyProviderOptions) {
    this.client = new ShopmonkeyClient(options);
    this.webhookSigningSecret = options.webhookSigningSecret;
  }

  async syncCatalog(connection: AdapterConnectionCredentials): Promise<SyncCatalogResult> {
    return syncShopmonkeyCatalog(this.client, connection.accessToken ?? "");
  }

  async pushBooking(
    connection: AdapterConnectionCredentials,
    params: PushBookingParams,
  ): Promise<PushBookingResult> {
    return pushShopmonkeyBooking(this.client, connection, params);
  }

  async handleWebhook(params: HandleWebhookParams): Promise<HandleWebhookResult> {
    const signatureHeader =
      params.headers["x-shopmonkey-signature"] ?? params.headers["X-Shopmonkey-Signature"];
    const verification = verifyShopmonkeyWebhookSignature({
      rawBody: params.rawBody,
      signatureHeader,
      signingSecret: this.webhookSigningSecret,
    });
    if (!verification.valid) return { valid: false, reason: verification.reason };

    let parsed: unknown;
    try {
      parsed = JSON.parse(params.rawBody);
    } catch {
      return { valid: false, reason: "invalid_json" };
    }
    return { valid: true, event: normalizeShopmonkeyWebhook(parsed) };
  }

  async pullChanges(params: PullChangesParams): Promise<PullChangesResult> {
    return pullShopmonkeyChanges(this.client, params);
  }

  async refreshAuth(connection: AdapterConnectionCredentials): Promise<RefreshAuthResult> {
    return refreshShopmonkeyAuth(this.client, connection);
  }
}
