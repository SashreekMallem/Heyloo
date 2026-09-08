/**
 * Outscraper Google Maps Search API via plain `fetch` (API_AND_FLOWS.md A.5,
 * T8 lead-fetch step) — Google-Maps-sourced leads for verticals where
 * Apollo is weak (restaurants, motels — VERTICAL_RESEARCH.md's finding that
 * these owners aren't well represented on Apollo/LinkedIn).
 *
 * VERIFY (docs/VERIFY.md): RESOLVED against the official `outscraper` npm
 * SDK (v2.2.2, `github.com/outscraper/outscraper-node`) — its own
 * `googleMapsSearchV3` confirms `GET /maps/search-v3`, `X-API-KEY` header
 * auth, `query`/`async` param names, and the `results_location` async-poll
 * pattern. Two of this build's original guesses were WRONG and are fixed
 * here: (1) the limit param is `organizationsPerQueryLimit`, not `limit`
 * (this build's original name matched nothing Outscraper's API recognizes,
 * so the parameter was silently ignored); (2) the poll's terminal-success
 * status string is `"Completed"` (confirmed by the SDK's own
 * "Async Google Maps Reviews.md" usage example: `status.status ===
 * 'Completed'`, with `"Running"`/`"Failed"` as the other documented
 * values), not `"Success"`/`"Finished"` as this build originally guessed —
 * meaning the poller would never have detected a finished job in
 * production. `"Failed"` is now treated as a terminal (non-retryable,
 * empty-result) outcome too, rather than being retried until the poll
 * attempt budget silently runs out.
 */

const OUTSCRAPER_BASE_URL = "https://api.app.outscraper.com";

export type OutscraperFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface OutscraperPlace {
  name?: string;
  full_address?: string;
  phone?: string;
  phone_1?: string;
  site?: string;
  category?: string;
  rating?: number;
}

export interface OutscraperStartResult {
  ok: boolean;
  status: number;
  requestId?: string;
  resultsLocation?: string;
  /** Some Outscraper endpoints can return results inline for a small/fast
   * query even with `async=true` requested — surfaced here so a caller can
   * skip polling entirely when this is already populated. */
  places?: OutscraperPlace[];
}

/**
 * `GET /maps/search-v3` — always requested async (never block an admin
 * request indefinitely on a scrape); returns a request id + a
 * `results_location` URL to poll via `pollGoogleMapsResults`.
 */
export async function startGoogleMapsSearch(
  fetchImpl: OutscraperFetch,
  apiKey: string,
  query: string,
  limit = 50,
): Promise<OutscraperStartResult> {
  const url = `${OUTSCRAPER_BASE_URL}/maps/search-v3?query=${encodeURIComponent(query)}&organizationsPerQueryLimit=${limit}&async=true`;
  const res = await fetchImpl(url, { method: "GET", headers: { "X-API-KEY": apiKey } });
  if (!res.ok) return { ok: false, status: res.status };
  const body = (await res.json().catch(() => undefined)) as
    | { id?: string; results_location?: string; data?: OutscraperPlace[][] }
    | undefined;
  const flattened = body?.data?.flat();
  return {
    ok: true,
    status: res.status,
    ...(body?.id ? { requestId: body.id } : {}),
    ...(body?.results_location ? { resultsLocation: body.results_location } : {}),
    ...(flattened && flattened.length > 0 ? { places: flattened } : {}),
  };
}

export interface OutscraperPollResult {
  ok: boolean;
  status: number;
  finished: boolean;
  places: OutscraperPlace[];
}

/** Polls the `results_location` URL from `startGoogleMapsSearch`. Callers
 * bound their own retry/backoff loop (this is a single poll, not a
 * blocking wait) — Outscraper's own guidance is results land "within
 * minutes", not synchronously, so a fetch-leads admin action retries a
 * few times with a short delay before giving up and reporting a partial
 * result rather than hanging the request indefinitely. */
export async function pollGoogleMapsResults(
  fetchImpl: OutscraperFetch,
  apiKey: string,
  resultsLocation: string,
): Promise<OutscraperPollResult> {
  const res = await fetchImpl(resultsLocation, { method: "GET", headers: { "X-API-KEY": apiKey } });
  if (!res.ok) return { ok: false, status: res.status, finished: false, places: [] };
  const body = (await res.json().catch(() => undefined)) as
    | { status?: string; data?: OutscraperPlace[][] }
    | undefined;
  // Confirmed terminal values (official SDK's own doc example): "Completed"
  // (success, data present) and "Failed" (terminal, no data) — anything
  // else ("Running", or an absent status) means keep polling.
  const succeeded = body?.status === "Completed";
  const failed = body?.status === "Failed";
  return {
    ok: true,
    status: res.status,
    finished: succeeded || failed,
    places: succeeded ? (body?.data?.flat() ?? []) : [],
  };
}
