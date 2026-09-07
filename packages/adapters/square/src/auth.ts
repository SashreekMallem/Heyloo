/**
 * `refreshAuth` for Square OAuth2 — `POST /oauth2/token`,
 * `grant_type=refresh_token` (API_AND_FLOWS.md A.6 auth model). WebSearch
 * corroboration during this build: refresh-token-obtained access tokens
 * expire 30 days after issuance and the SAME refresh token is returned
 * (not rotated) — VERIFY against a live sandbox app before relying on this
 * for the proactive-refresh cadence (docs/VERIFY.md).
 */

import { VoiceProviderError } from "@heyloo/canonical-types";
import { z } from "zod";
import type { AdapterConnectionCredentials, RefreshAuthResult } from "./adapter-types.js";
import type { SquareClient } from "./client.js";

const zTokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_at: z.string().optional(),
  merchant_id: z.string().optional(),
});

export interface SquareAuthOptions {
  clientId: string;
  clientSecret: string;
}

export async function refreshSquareAuth(
  client: SquareClient,
  options: SquareAuthOptions,
  connection: AdapterConnectionCredentials,
): Promise<RefreshAuthResult> {
  if (!connection.refreshToken) {
    throw new VoiceProviderError("square refreshAuth requires connection.refreshToken", {
      code: "auth",
      provider: "square",
      retryable: false,
    });
  }

  try {
    const raw = await client.requestToken<unknown>({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
    });
    const parsed = zTokenResponse.parse(raw);
    return {
      revoked: false,
      credentials: {
        ...connection,
        accessToken: parsed.access_token,
        refreshToken: parsed.refresh_token ?? connection.refreshToken,
        expiresAt: parsed.expires_at,
        providerAccountId: parsed.merchant_id ?? connection.providerAccountId,
      },
    };
  } catch (cause) {
    if (cause instanceof VoiceProviderError && cause.code === "auth") {
      // Square returns an OAuth error (e.g. invalid_grant) when the
      // merchant has revoked the app's authorization — never retry this,
      // surface it as a revocation (BACKEND_SPEC §7.6 "auth_revoked").
      return { revoked: true, credentials: connection };
    }
    throw cause;
  }
}
