/**
 * `EzyVetProvider implements IntegrationAdapter`. Unlike Square/Google
 * (one global API host), each connection carries its OWN base URL (the
 * practice's ezyVet database subdomain) — the provider is constructed
 * per-connection's host at call time via `client.js`'s `baseUrl` option,
 * so this class takes a `resolveBaseUrl` hook rather than a single fixed
 * client instance.
 */

import { VoiceProviderError } from "@heyloo/canonical-types";
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
import { type EzyVetAuthOptions, refreshEzyVetAuth } from "./auth.js";
import { checkEzyVetAvailability } from "./availability.js";
import { pushEzyVetBooking } from "./booking.js";
import { syncEzyVetCatalog } from "./catalog.js";
import { EzyVetClient, type EzyVetClientOptions } from "./client.js";
import { pullEzyVetChanges } from "./sync.js";
import { handleEzyVetWebhook } from "./webhook.js";

export const EZYVET_CAPABILITIES: AdapterCapabilities = {
  supportsCatalogSync: true,
  supportsAvailabilityCheck: true,
  supportsBookingPush: true,
  supportsOrderPush: false,
  supportsChangeWebhooks: false,
  authMode: "oauth2_client_credentials",
};

export interface EzyVetProviderOptions extends EzyVetAuthOptions {
  clientOptions?: Omit<EzyVetClientOptions, "baseUrl">;
}

function resolveBaseUrl(connection: AdapterConnectionCredentials): string {
  const baseUrl = connection.metadata?.["baseUrl"];
  if (typeof baseUrl !== "string" || baseUrl.length === 0) {
    throw new VoiceProviderError(
      "ezyvet adapter requires connection.metadata.baseUrl (the practice's own ezyVet database subdomain)",
      { code: "validation", provider: "ezyvet", retryable: false },
    );
  }
  return baseUrl;
}

export class EzyVetProvider implements IntegrationAdapter {
  readonly name = "ezyvet";
  readonly capabilities = EZYVET_CAPABILITIES;

  private readonly authOptions: EzyVetAuthOptions;
  private readonly clientOptions: Omit<EzyVetClientOptions, "baseUrl">;

  constructor(options: EzyVetProviderOptions) {
    this.authOptions = {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      partnerId: options.partnerId,
    };
    this.clientOptions = options.clientOptions ?? {};
  }

  private clientFor(connection: AdapterConnectionCredentials): EzyVetClient {
    return new EzyVetClient({ ...this.clientOptions, baseUrl: resolveBaseUrl(connection) });
  }

  async syncCatalog(connection: AdapterConnectionCredentials): Promise<SyncCatalogResult> {
    return syncEzyVetCatalog(this.clientFor(connection), connection.accessToken ?? "");
  }

  async checkAvailability(
    connection: AdapterConnectionCredentials,
    params: CheckAvailabilityParams,
  ): Promise<CheckAvailabilityResult> {
    return checkEzyVetAvailability(this.clientFor(connection), connection, params);
  }

  async pushBooking(
    connection: AdapterConnectionCredentials,
    params: PushBookingParams,
  ): Promise<PushBookingResult> {
    return pushEzyVetBooking(this.clientFor(connection), connection, params);
  }

  async handleWebhook(_params: HandleWebhookParams): Promise<HandleWebhookResult> {
    return handleEzyVetWebhook();
  }

  async pullChanges(params: PullChangesParams): Promise<PullChangesResult> {
    return pullEzyVetChanges(this.clientFor(params.connection), params);
  }

  async refreshAuth(connection: AdapterConnectionCredentials): Promise<RefreshAuthResult> {
    return refreshEzyVetAuth(this.clientFor(connection), this.authOptions, connection);
  }
}
