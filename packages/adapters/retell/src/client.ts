/**
 * Minimal REST client for the Retell API (API_AND_FLOWS.md A.1: "All Retell
 * calls are REST, `Authorization: Bearer <RETELL_API_KEY>`, base
 * `https://api.retellai.com`"). Retry/backoff + typed errors only — no
 * generated SDK dependency, so the provider-isolation lint rule has exactly
 * one thing to restrict (`fetch` calls, confined to this file and its
 * callers within this package).
 */

import { type ProviderErrorCode, VoiceProviderError } from "@heyloo/canonical-types";

export const RETELL_API_BASE_URL = "https://api.retellai.com";

export interface RetellClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Total attempts including the first (default 3 — 1 try + 2 retries). */
  maxAttempts?: number;
  /** Base delay for exponential backoff, ms (default 250). */
  baseDelayMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable sleep for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

function httpStatusToErrorCode(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server_error";
  if (status >= 400) return "validation";
  return "unknown";
}

/** Retry on 429/5xx and network failures; never on 4xx (a bad request retried is still a bad request). */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export class RetellClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: RetellClientOptions) {
    if (!options.apiKey) {
      // Fail closed: never construct a client that would silently send unauthenticated requests.
      throw new VoiceProviderError("RetellClient requires a non-empty apiKey", {
        code: "auth",
        provider: "retell",
        retryable: false,
      });
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? RETELL_API_BASE_URL;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 250;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async request<TResponse = unknown>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<TResponse> {
    const url = `${this.baseUrl}${path}`;
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
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
          `retell request failed: network error calling ${method} ${path}`,
          {
            code: "network",
            provider: "retell",
            retryable: true,
            cause,
          },
        );
      }

      if (response.ok) {
        if (response.status === 204) return undefined as TResponse;
        const text = await response.text();
        if (text.length === 0) return undefined as TResponse;
        try {
          return JSON.parse(text) as TResponse;
        } catch (cause) {
          throw new VoiceProviderError(
            `retell request ${method} ${path} returned non-JSON 2xx body`,
            { code: "unknown", provider: "retell", retryable: false, cause },
          );
        }
      }

      const errorCode = httpStatusToErrorCode(response.status);
      const retryable = isRetryableStatus(response.status);
      const bodyText = await response.text().catch(() => "");

      if (retryable && attempt < this.maxAttempts) {
        lastError = bodyText;
        await this.sleep(this.baseDelayMs * 2 ** (attempt - 1));
        continue;
      }

      throw new VoiceProviderError(
        `retell request ${method} ${path} failed with HTTP ${response.status}${
          bodyText ? `: ${bodyText.slice(0, 500)}` : ""
        }`,
        { code: errorCode, provider: "retell", retryable, httpStatus: response.status },
      );
    }

    // Unreachable in practice (the loop always returns or throws), but keeps the type checker honest.
    throw new VoiceProviderError(`retell request ${method} ${path} exhausted retries`, {
      code: "network",
      provider: "retell",
      retryable: true,
      cause: lastError,
    });
  }
}
