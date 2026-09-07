/**
 * `refreshAuth` for Shopmonkey — a paste-key connection has no OAuth
 * refresh_token to exchange (client.ts's docstring explains the connect
 * model). "Refreshing" here means re-validating the stored key is still
 * good (`GET /me`, VERIFY exact identity endpoint path) — a tenant who
 * revokes/regenerates the key in their own Shopmonkey dashboard makes this
 * call start 401ing, which is exactly the `auth_revoked` signal
 * BACKEND_SPEC §7.6 wants surfaced as a disconnected-connection banner.
 */

import { VoiceProviderError } from "@heyloo/canonical-types";
import type { AdapterConnectionCredentials, RefreshAuthResult } from "./adapter-types.js";
import type { ShopmonkeyClient } from "./client.js";

export async function refreshShopmonkeyAuth(
  client: ShopmonkeyClient,
  connection: AdapterConnectionCredentials,
): Promise<RefreshAuthResult> {
  if (!connection.accessToken) {
    throw new VoiceProviderError(
      "shopmonkey refreshAuth requires connection.accessToken (the pasted API key)",
      {
        code: "auth",
        provider: "shopmonkey",
        retryable: false,
      },
    );
  }
  try {
    await client.request("GET", "/me", connection.accessToken);
    return { revoked: false, credentials: connection };
  } catch (cause) {
    if (cause instanceof VoiceProviderError && cause.code === "auth") {
      return { revoked: true, credentials: connection };
    }
    throw cause;
  }
}
