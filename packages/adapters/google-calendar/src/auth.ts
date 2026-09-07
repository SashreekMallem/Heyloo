/**
 * `refreshAuth` for Google Calendar — standard OAuth2 refresh-token grant
 * (API_AND_FLOWS.md A.6 "Auth model: OAuth2 ... `calendar` scope"). Google
 * does not re-issue a refresh token on this grant (the original one from
 * the authorization-code exchange stays valid indefinitely until the user
 * revokes access), so `credentials.refreshToken` is carried forward
 * unchanged. `invalid_grant` is Google's documented response for a
 * revoked/expired refresh token — treated as `revoked: true`, never
 * retried.
 */

import { VoiceProviderError } from "@heyloo/canonical-types";
import type { AdapterConnectionCredentials, RefreshAuthResult } from "./adapter-types.js";
import type { GoogleCalendarClient } from "./client.js";

export interface GoogleCalendarAuthOptions {
  clientId: string;
  clientSecret: string;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

export async function refreshGoogleCalendarAuth(
  client: GoogleCalendarClient,
  options: GoogleCalendarAuthOptions,
  connection: AdapterConnectionCredentials,
): Promise<RefreshAuthResult> {
  if (!connection.refreshToken) {
    throw new VoiceProviderError("google-calendar refreshAuth requires connection.refreshToken", {
      code: "auth",
      provider: "google-calendar",
      retryable: false,
    });
  }

  try {
    const token = await client.requestToken<GoogleTokenResponse>({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
    });
    const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
    return {
      revoked: false,
      credentials: { ...connection, accessToken: token.access_token, expiresAt },
    };
  } catch (cause) {
    if (cause instanceof VoiceProviderError && cause.code === "auth") {
      return { revoked: true, credentials: connection };
    }
    throw cause;
  }
}
