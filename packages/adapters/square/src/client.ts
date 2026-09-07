/**
 * Minimal REST client for the Square API (API_AND_FLOWS.md A.6 "Square
 * (Orders + Bookings)"; SYSTEM_DESIGN §14 salvage notes). No SDK dependency
 * (`square`'s official Node SDK is deliberately not used, matching T3's
 * `_shared/providers/*.ts` precedent for the same reasons: leanness, and one
 * less thing for the provider-isolation lint rule to need updating for).
 *
 * VERIFY (docs/VERIFY.md): `developer.squareup.com` was egress-blocked in
 * this build environment; every endpoint/field below is the shape
 * WebSearch-corroborated third-party summaries + SYSTEM_DESIGN §14's own
 * salvage notes describe, not a first-party fetch. Re-confirm against a
 * live sandbox app before the first real OAuth connect.
 */

import { VoiceProviderError } from "@heyloo/canonical-types";

export const SQUARE_PRODUCTION_BASE_URL = "https://connect.squareup.com";
export const SQUARE_SANDBOX_BASE_URL = "https://connect.squareupsandbox.com";
/** Square requires a `Square-Version` header pinning the API release the
 * caller was built against (date-versioned). VERIFY: bump before go-live. */
export const SQUARE_API_VERSION = "2026-01-22";

export interface SquareClientOptions {
  baseUrl?: string;
  apiVersion?: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Square access tokens are per-tenant (OAuth), unlike Retell's single
 * platform API key — every request carries the caller's own bearer token,
 * so (unlike `RetellClient`) this client takes no fixed credential at
 * construction time; callers pass `accessToken` per request.
 */
export class SquareClient {
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: SquareClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? SQUARE_PRODUCTION_BASE_URL;
    this.apiVersion = options.apiVersion ?? SQUARE_API_VERSION;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 250;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async request<TResponse = unknown>(
    method: "GET" | "POST" | "PUT",
    path: string,
    accessToken: string,
    body?: unknown,
  ): Promise<TResponse> {
    if (!accessToken) {
      throw new VoiceProviderError("SquareClient.request requires a non-empty accessToken", {
        code: "auth",
        provider: "square",
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
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "Square-Version": this.apiVersion,
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
          `square request failed: network error calling ${method} ${path}`,
          {
            code: "network",
            provider: "square",
            retryable: true,
            cause,
          },
        );
      }

      if (response.ok) {
        if (response.status === 204) return undefined as TResponse;
        const text = await response.text();
        if (text.length === 0) return undefined as TResponse;
        return JSON.parse(text) as TResponse;
      }

      const retryable = isRetryableStatus(response.status);
      const bodyText = await response.text().catch(() => "");
      if (retryable && attempt < this.maxAttempts) {
        lastError = bodyText;
        await this.sleep(this.baseDelayMs * 2 ** (attempt - 1));
        continue;
      }

      throw new VoiceProviderError(
        `square request ${method} ${path} failed with HTTP ${response.status}${
          bodyText ? `: ${bodyText.slice(0, 500)}` : ""
        }`,
        {
          code: response.status === 401 || response.status === 403 ? "auth" : "validation",
          provider: "square",
          retryable,
          httpStatus: response.status,
        },
      );
    }

    throw new VoiceProviderError(`square request ${method} ${path} exhausted retries`, {
      code: "network",
      provider: "square",
      retryable: true,
      cause: lastError,
    });
  }

  /** OAuth token exchange doesn't carry a bearer token of its own — it's a
   * plain POST with client credentials in the body (`/oauth2/token`). */
  async requestToken<TResponse = unknown>(body: Record<string, unknown>): Promise<TResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Square-Version": this.apiVersion },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const parsed = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok) {
      const errorCode = typeof parsed["type"] === "string" ? (parsed["type"] as string) : "unknown";
      throw new VoiceProviderError(`square oauth2/token failed: ${errorCode}`, {
        code: response.status === 401 ? "auth" : "validation",
        provider: "square",
        retryable: false,
        httpStatus: response.status,
      });
    }
    return parsed as TResponse;
  }
}
