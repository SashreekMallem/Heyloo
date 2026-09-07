/**
 * Minimal REST client for the ezyVet API (API_AND_FLOWS.md A.6 "ezyVet
 * (veterinary)"). No SDK dependency, matching every other adapter here.
 *
 * VERIFY (docs/VERIFY.md): `developers.ezyvet.com` was egress-blocked in
 * this build environment. ezyVet is a per-practice ("database") API: each
 * connected practice has its own base URL (a practice-specific subdomain,
 * per VERTICAL_RESEARCH.md/API_AND_FLOWS.md's description of a
 * partner-gated, per-database integration) — this client takes that base
 * URL per instance rather than hardcoding one host, unlike Square/Google
 * which share one global API host across every tenant.
 *
 * Rate limit (API_AND_FLOWS.md A.6, confirmed in the spec docs' own
 * research): a GLOBAL 180 calls/minute ceiling PER DATABASE PER PARTNER —
 * this client enforces a client-side sliding-window throttle so a bulk
 * catalog sync or a burst of pushes never trips ezyVet's own rate limiter
 * (which would otherwise surface as an opaque 429 mid-sync).
 */

import { VoiceProviderError } from "@heyloo/canonical-types";

export const EZYVET_RATE_LIMIT_PER_MINUTE = 180;

export interface EzyVetClientOptions {
  /** This practice/database's base URL, e.g. `https://{subdomain}.ezyvet.com/api/v1`. */
  baseUrl: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock for deterministic rate-limiter tests. */
  now?: () => number;
  rateLimitPerMinute?: number;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** A simple sliding-window request timestamp tracker — not a token bucket,
 * since ezyVet's documented limit is a flat per-minute ceiling, not a
 * burst+refill shape. */
class SlidingWindowLimiter {
  private readonly windowMs = 60_000;
  private readonly limit: number;
  private readonly now: () => number;
  private timestamps: number[] = [];

  constructor(limit: number, now: () => number) {
    this.limit = limit;
    this.now = now;
  }

  /** Resolves once a new request is safe to send, sleeping if the window
   * is currently full. */
  async acquire(sleep: (ms: number) => Promise<void>): Promise<void> {
    for (;;) {
      const now = this.now();
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
      if (this.timestamps.length < this.limit) {
        this.timestamps.push(now);
        return;
      }
      const oldest = this.timestamps[0] ?? now;
      const waitMs = Math.max(0, this.windowMs - (now - oldest));
      await sleep(waitMs + 1);
    }
  }
}

export class EzyVetClient {
  readonly baseUrl: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly limiter: SlidingWindowLimiter;

  constructor(options: EzyVetClientOptions) {
    this.baseUrl = options.baseUrl;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 250;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.limiter = new SlidingWindowLimiter(
      options.rateLimitPerMinute ?? EZYVET_RATE_LIMIT_PER_MINUTE,
      options.now ?? (() => Date.now()),
    );
  }

  async request<TResponse = unknown>(
    method: "GET" | "POST" | "PUT" | "PATCH",
    path: string,
    accessToken: string,
    body?: unknown,
  ): Promise<TResponse> {
    if (!accessToken) {
      throw new VoiceProviderError("EzyVetClient.request requires a non-empty accessToken", {
        code: "auth",
        provider: "ezyvet",
        retryable: false,
      });
    }
    await this.limiter.acquire(this.sleep);

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
          `ezyvet request failed: network error calling ${method} ${path}`,
          {
            code: "network",
            provider: "ezyvet",
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
        `ezyvet request ${method} ${path} failed with HTTP ${response.status}${
          bodyText ? `: ${bodyText.slice(0, 500)}` : ""
        }`,
        {
          code: response.status === 401 || response.status === 403 ? "auth" : "validation",
          provider: "ezyvet",
          retryable,
          httpStatus: response.status,
        },
      );
    }

    throw new VoiceProviderError(`ezyvet request ${method} ${path} exhausted retries`, {
      code: "network",
      provider: "ezyvet",
      retryable: true,
      cause: lastError,
    });
  }

  /** OAuth2 client-credentials token mint — no bearer token of its own yet. */
  async requestToken<TResponse = unknown>(body: Record<string, string>): Promise<TResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
    const text = await response.text();
    const parsed = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok) {
      const errorCode =
        typeof parsed["error"] === "string" ? (parsed["error"] as string) : "unknown";
      throw new VoiceProviderError(`ezyvet oauth/access_token failed: ${errorCode}`, {
        code: response.status === 401 || response.status === 403 ? "auth" : "validation",
        provider: "ezyvet",
        retryable: false,
        httpStatus: response.status,
      });
    }
    return parsed as TResponse;
  }
}
