/**
 * Minimal REST client for the Shopmonkey API (API_AND_FLOWS.md A.6
 * "Shopmonkey (auto repair)"). No SDK dependency, matching every other
 * adapter here.
 *
 * VERIFY (docs/VERIFY.md): `shopmonkey.dev` was egress-blocked in this
 * build environment. Auth model resolved per API_AND_FLOWS.md's own
 * preamble ("Two connection modes exist ... self-generated paste-key
 * (Shopmonkey, Cloudbeds...)") over its per-adapter section's "Shopmonkey
 * 2.0 uses OAuth2 Bearer tokens via /auth/login" line: WebSearch
 * corroboration during this build found Shopmonkey ALSO exposes a
 * `/apikey` route that mints a static(-ish), optionally-expiring API key
 * from an already-authenticated session, carrying the permissions of the
 * user who requested it — that key is what the tenant pastes into
 * Heyloo's connect flow (this adapter never performs the email/password
 * login itself; connecting a Shopmonkey account is the tenant's own
 * one-time action in their Shopmonkey dashboard). Every request below is
 * still a plain Bearer token, so the wire shape is identical either way —
 * only the CONNECT flow differs (`api-adapter-connect`'s paste-key path,
 * not an OAuth redirect).
 */

import { VoiceProviderError } from "@heyloo/canonical-types";

export const SHOPMONKEY_BASE_URL = "https://api.shopmonkey.cloud/v3";

export interface ShopmonkeyClientOptions {
  baseUrl?: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export class ShopmonkeyClient {
  readonly baseUrl: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ShopmonkeyClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? SHOPMONKEY_BASE_URL;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 250;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async request<TResponse = unknown>(
    method: "GET" | "POST" | "PUT" | "PATCH",
    path: string,
    apiKey: string,
    body?: unknown,
  ): Promise<TResponse> {
    if (!apiKey) {
      throw new VoiceProviderError("ShopmonkeyClient.request requires a non-empty apiKey", {
        code: "auth",
        provider: "shopmonkey",
        retryable: false,
      });
    }
    const url = `${this.baseUrl}${path}`;
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      } catch (cause) {
        lastError = cause;
        if (attempt < this.maxAttempts) {
          await this.sleep(this.baseDelayMs * 2 ** (attempt - 1));
          continue;
        }
        throw new VoiceProviderError(
          `shopmonkey request failed: network error calling ${method} ${path}`,
          {
            code: "network",
            provider: "shopmonkey",
            retryable: true,
            cause,
          },
        );
      }

      if (response.ok) {
        if (response.status === 204) return undefined as TResponse;
        const text = await response.text();
        return text.length > 0 ? (JSON.parse(text) as TResponse) : (undefined as TResponse);
      }

      const retryable = isRetryableStatus(response.status);
      const bodyText = await response.text().catch(() => "");
      if (retryable && attempt < this.maxAttempts) {
        lastError = bodyText;
        await this.sleep(this.baseDelayMs * 2 ** (attempt - 1));
        continue;
      }

      throw new VoiceProviderError(
        `shopmonkey request ${method} ${path} failed with HTTP ${response.status}${
          bodyText ? `: ${bodyText.slice(0, 500)}` : ""
        }`,
        {
          code: response.status === 401 || response.status === 403 ? "auth" : "validation",
          provider: "shopmonkey",
          retryable,
          httpStatus: response.status,
        },
      );
    }

    throw new VoiceProviderError(`shopmonkey request ${method} ${path} exhausted retries`, {
      code: "network",
      provider: "shopmonkey",
      retryable: true,
      cause: lastError,
    });
  }
}
