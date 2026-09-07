/**
 * `refreshAuth` for ezyVet — OAuth2 Client Credentials grant
 * (API_AND_FLOWS.md A.6: "partner-gated ... access tokens have a 12-hour
 * TTL"). There is no refresh_token in the client-credentials flow — every
 * "refresh" simply re-mints a fresh token from the partner's own
 * `client_id`/`client_secret` + the approved `partner_id`, scoped to the
 * connected practice's own database via its base URL (VERIFY exact grant
 * parameter names against ezyVet's live sandbox, docs/VERIFY.md).
 *
 * BACKEND_SPEC §7.6 explicitly calls out that this should run PROACTIVELY
 * (e.g. at 10h of the 12h TTL) rather than reactively on first 401, to
 * avoid a live booking-write racing an expired token — `shouldRefresh`
 * implements that check for the caller (worker-adapter-push) to use before
 * every push, not just on failure.
 */

import { VoiceProviderError } from "@heyloo/canonical-types";
import type { AdapterConnectionCredentials, RefreshAuthResult } from "./adapter-types.js";
import type { EzyVetClient } from "./client.js";

export const EZYVET_TOKEN_TTL_SECONDS = 12 * 60 * 60;
/** Refresh once at least 2 hours of the 12h token life remain unused — the
 * "proactively at 10h" cadence BACKEND_SPEC §7.6 calls for. */
export const EZYVET_PROACTIVE_REFRESH_MARGIN_SECONDS = 2 * 60 * 60;

export interface EzyVetAuthOptions {
  clientId: string;
  clientSecret: string;
  partnerId: string;
}

interface EzyVetTokenResponse {
  access_token: string;
  expires_in?: number;
}

export function shouldRefreshEzyVetAuth(
  connection: AdapterConnectionCredentials,
  now: () => number = () => Date.now(),
): boolean {
  if (!connection.expiresAt) return true;
  const expiresAtMs = Date.parse(connection.expiresAt);
  if (Number.isNaN(expiresAtMs)) return true;
  return expiresAtMs - now() <= EZYVET_PROACTIVE_REFRESH_MARGIN_SECONDS * 1000;
}

export async function refreshEzyVetAuth(
  client: EzyVetClient,
  options: EzyVetAuthOptions,
  connection: AdapterConnectionCredentials,
): Promise<RefreshAuthResult> {
  try {
    const token = await client.requestToken<EzyVetTokenResponse>({
      grant_type: "client_credentials",
      client_id: options.clientId,
      client_secret: options.clientSecret,
      partner_id: options.partnerId,
    });
    const ttlSeconds = token.expires_in ?? EZYVET_TOKEN_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    return {
      revoked: false,
      credentials: { ...connection, accessToken: token.access_token, expiresAt },
    };
  } catch (cause) {
    if (cause instanceof VoiceProviderError && cause.code === "auth") {
      // A rejected client-credentials mint for a previously-working
      // connection means the practice revoked our partner authorization
      // for their database (BACKEND_SPEC §7.6 "refreshAuth failure ...
      // mark the connection disconnected").
      return { revoked: true, credentials: connection };
    }
    throw cause;
  }
}
