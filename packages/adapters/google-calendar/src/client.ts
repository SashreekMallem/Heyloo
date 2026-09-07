/**
 * Minimal REST client for the Google Calendar API v3 (API_AND_FLOWS.md A.6
 * "Google Calendar (generic calendar adapter, G10)"). No `googleapis`
 * SDK dependency — plain `fetch`, matching every other adapter in this
 * build. VERIFY (docs/VERIFY.md): `developers.google.com` was egress-
 * blocked in this environment; endpoint paths/fields below are corroborated
 * by WebSearch against current third-party summaries of Google's own docs,
 * not a first-party fetch.
 */

import { VoiceProviderError } from "@heyloo/canonical-types";

export const GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleCalendarClientOptions {
  baseUrl?: string;
  oauthTokenUrl?: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export class GoogleCalendarClient {
  readonly baseUrl: string;
  readonly oauthTokenUrl: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: GoogleCalendarClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? GOOGLE_CALENDAR_BASE_URL;
    this.oauthTokenUrl = options.oauthTokenUrl ?? GOOGLE_OAUTH_TOKEN_URL;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 250;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async request<TResponse = unknown>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    accessToken: string,
    body?: unknown,
  ): Promise<TResponse> {
    if (!accessToken) {
      throw new VoiceProviderError(
        "GoogleCalendarClient.request requires a non-empty accessToken",
        {
          code: "auth",
          provider: "google-calendar",
          retryable: false,
        },
      );
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
          `google-calendar request failed: network error calling ${method} ${path}`,
          { code: "network", provider: "google-calendar", retryable: true, cause },
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
        `google-calendar request ${method} ${path} failed with HTTP ${response.status}${
          bodyText ? `: ${bodyText.slice(0, 500)}` : ""
        }`,
        {
          code: response.status === 401 || response.status === 403 ? "auth" : "validation",
          provider: "google-calendar",
          retryable,
          httpStatus: response.status,
        },
      );
    }

    throw new VoiceProviderError(`google-calendar request ${method} ${path} exhausted retries`, {
      code: "network",
      provider: "google-calendar",
      retryable: true,
      cause: lastError,
    });
  }

  async requestToken<TResponse = unknown>(body: Record<string, string>): Promise<TResponse> {
    const response = await this.fetchImpl(this.oauthTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
    const text = await response.text();
    const parsed = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok) {
      const errorCode =
        typeof parsed["error"] === "string" ? (parsed["error"] as string) : "unknown";
      throw new VoiceProviderError(`google-calendar oauth token request failed: ${errorCode}`, {
        code: errorCode === "invalid_grant" ? "auth" : "validation",
        provider: "google-calendar",
        retryable: false,
        httpStatus: response.status,
      });
    }
    return parsed as TResponse;
  }
}
