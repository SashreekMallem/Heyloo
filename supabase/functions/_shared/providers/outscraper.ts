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
  /** Google's own place id — confirmed field name `place_id` on a
   * `/maps/search-v3` result row (official `outscraper` npm SDK's own
   * `examples/Google Maps.md`: "Scrap Places by Place Ids" example logs
   * `place.place_id`). This is the id the Reviews endpoint below takes as
   * its `query` input, so it's captured into `leads.enrichment.
   * google_place_id` at fetch time (OUTREACH-2) specifically so a later
   * review-scoring pass has something to fetch reviews for. */
  place_id?: string;
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

// ---------------------------------------------------------------------
// Google Maps Reviews (`GET /maps/reviews-v3`, OUTREACH-2 — review-mining
// phone-complaint filter, docs/research/CUSTOMER_ACQUISITION_TOOLS_2026.md
// recommendation #2 / docs/spec/API_AND_FLOWS.md Flow 5).
//
// VERIFY (docs/VERIFY.md): endpoint path, param names (`query`/
// `reviewsLimit`/`limit`/`sort`/`async`), and the async envelope
// (`id`/`results_location`, same `Completed`/`Failed`/`Running` status
// strings as the search endpoint above) confirmed HIGH-CONFIDENCE against
// the official `outscraper` npm SDK's own source
// (`outscraper-node@2.2.2`'s `index.js`: `googleMapsReviews(...)` ->
// `getAPIRequest('/maps/reviews-v3', {query, reviewsLimit, reviewsQuery,
// limit, sort, lastPaginationId, start, cutoff, cutoffRating, ignoreEmpty,
// source, language, region, fields, async})`, `X-API-KEY` header auth,
// same `querystring.stringify` GET-request shape as every other endpoint
// in this file) and the SDK's own bundled example
// (`examples/Google Maps Reviews.md`: `place.reviews_data.forEach(review
// => console.log(review.review_text))` — confirms the response nests an
// array of place objects, each with a `reviews_data` array whose entries
// carry `review_text`). The PER-REVIEW field names beyond `review_text`
// (`review_rating`, `review_timestamp`, `review_datetime_utc`, `google_id`
// for the place) were confirmed against outscraper.com's own public
// Google Maps Reviews API product/pricing page rather than the npm
// package itself (that page was reached via an AI-summarizing fetch tool,
// not raw byte inspection of the page's HTML) — logged to docs/VERIFY.md
// as a MEDIUM-confidence item to spot-check against one live response
// before this scoring pass goes live. Every field below is therefore
// `?:` optional and the classifier boundary (`_shared/schemas/review-
// score.ts`) never assumes a field is present.
// ---------------------------------------------------------------------

export interface OutscraperReview {
  review_text?: string;
  review_rating?: number;
  review_datetime_utc?: string;
  review_timestamp?: number;
}

export interface OutscraperPlaceReviews {
  google_id?: string;
  name?: string;
  reviews_data?: OutscraperReview[];
}

export interface OutscraperReviewsStartResult {
  ok: boolean;
  status: number;
  requestId?: string;
  resultsLocation?: string;
  /** Populated when Outscraper returns results inline despite `async=true`
   * being requested — same "some endpoints answer fast enough to skip the
   * poll" behavior `startGoogleMapsSearch` already documents. */
  places?: OutscraperPlaceReviews[];
}

/**
 * `GET /maps/reviews-v3` — always requested async (never block an admin/
 * cron request on a scrape that can take minutes for many place ids at
 * once). `placeIds` matches this file's own `OutscraperPlace.place_id`
 * capture at lead-fetch time; `reviewsLimit` bounds the per-lead review
 * count (OUTREACH-2's own N=20 cost-bounding rule).
 */
export async function startGoogleMapsReviews(
  fetchImpl: OutscraperFetch,
  apiKey: string,
  placeIds: string[],
  reviewsLimit = 20,
): Promise<OutscraperReviewsStartResult> {
  const query = placeIds.map(encodeURIComponent).join(",");
  const url =
    `${OUTSCRAPER_BASE_URL}/maps/reviews-v3?query=${query}` +
    `&reviewsLimit=${reviewsLimit}&limit=1&sort=most_relevant&async=true`;
  const res = await fetchImpl(url, { method: "GET", headers: { "X-API-KEY": apiKey } });
  if (!res.ok) return { ok: false, status: res.status };
  const body = (await res.json().catch(() => undefined)) as
    | { id?: string; results_location?: string; data?: OutscraperPlaceReviews[][] }
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

export interface OutscraperReviewsPollResult {
  ok: boolean;
  status: number;
  finished: boolean;
  places: OutscraperPlaceReviews[];
}

/** Polls the `results_location` URL from `startGoogleMapsReviews` — same
 * single-poll, caller-bounds-the-loop contract as `pollGoogleMapsResults`,
 * same confirmed terminal status strings (`"Completed"`/`"Failed"`). */
export async function pollGoogleMapsReviews(
  fetchImpl: OutscraperFetch,
  apiKey: string,
  resultsLocation: string,
): Promise<OutscraperReviewsPollResult> {
  const res = await fetchImpl(resultsLocation, { method: "GET", headers: { "X-API-KEY": apiKey } });
  if (!res.ok) return { ok: false, status: res.status, finished: false, places: [] };
  const body = (await res.json().catch(() => undefined)) as
    | { status?: string; data?: OutscraperPlaceReviews[][] }
    | undefined;
  const succeeded = body?.status === "Completed";
  const failed = body?.status === "Failed";
  return {
    ok: true,
    status: res.status,
    finished: succeeded || failed,
    places: succeeded ? (body?.data?.flat() ?? []) : [],
  };
}
