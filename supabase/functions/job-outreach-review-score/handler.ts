import { extractJsonObject } from "../_shared/json-extract.ts";
import { recordPipelineCost } from "../_shared/outreach-cost.ts";
import type { AnthropicFetch } from "../_shared/providers/anthropic.ts";
import { classifyPhoneComplaintScore } from "../_shared/providers/anthropic.ts";
import type { OutscraperFetch, OutscraperPlaceReviews } from "../_shared/providers/outscraper.ts";
import { pollGoogleMapsReviews, startGoogleMapsReviews } from "../_shared/providers/outscraper.ts";
import type { ReviewComplaintEvidence } from "../_shared/schemas/review-score.ts";
import { ReviewScoreClassificationSchema } from "../_shared/schemas/review-score.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `job-outreach-review-score` (OUTREACH-2 — docs/research/
 * CUSTOMER_ACQUISITION_TOOLS_2026.md recommendation #2: "review-mining
 * filter for phone/voicemail complaints", docs/spec/API_AND_FLOWS.md
 * Flow 5 step 2). A standalone job rather than a stage folded into
 * `job-outreach-personalize` (a deliberate scope decision, docs/
 * BUILD_NOTES.md OUTREACH-2 entry): the personalize submit/collect pair is
 * already a two-phase Batches-API pipeline keyed on `status = 'queued'`
 * AND gated on `research_batch_id`/`personalization` enrichment keys —
 * threading a THIRD provider (Outscraper) and a differently-shaped
 * selection query (`reviews_analyzed_at is null` + a Google place id,
 * independent of `status`, since a lead can be usefully re-ranked by
 * complaint score even before it's queued for send) through that same
 * file would overload one handler with two independent selection/failure-
 * mode contracts. This job runs entirely on its own cadence (hourly, cost-
 * bounded) and only ever WRITES `leads.phone_complaint_score`/
 * `phone_complaint_evidence`/`reviews_analyzed_at` — `job-outreach-
 * personalize-collect` reads those columns (never writes them) to sharpen
 * its own opening-line hook when a lead's score clears the threshold.
 *
 * Cost-bounded per this task's own instruction: `PER_LEAD_REVIEWS_LIMIT`
 * (N=20 reviews/lead) and `PER_RUN_LEAD_CAP` (25 leads/run — hourly cadence
 * x 25 = 600 leads/day ceiling, well inside a 500-1000/wk fetch batch) both
 * bound a single run's real-money Outscraper spend; every call's cost is
 * recorded into `pipeline_costs` (category `review_scoring`) exactly like
 * `api-outreach-fetch-leads/handler.ts` already does for its own Outscraper
 * Maps-search spend.
 *
 * Failure handling matches every other Anthropic call site in this
 * codebase (API_AND_FLOWS.md A.5's documented rule): a failed/unparseable/
 * schema-invalid classification never blocks anything downstream — the
 * lead is still marked `reviews_analyzed_at` (the Outscraper spend already
 * happened; re-billing it on every retry forever would defeat the whole
 * point of cost-bounding) but `phone_complaint_score` stays null rather
 * than a guessed value, and `job-outreach-personalize-collect` already
 * treats a null score as "below threshold" (no complaint-aware opener).
 *
 * Snippet-substring enforcement (task step 2's own hard requirement,
 * "never invent snippets — must be substrings of the input reviews"):
 * `filterFabricatedEvidence` below is the actual enforcement point — the
 * zod schema (`_shared/schemas/review-score.ts`) only checks each
 * snippet's SHAPE (a bounded non-empty string), since it has no access to
 * the original review text to check against. Any evidence entry whose
 * snippet is not found verbatim in at least one of this lead's own
 * fetched reviews is silently dropped (not the whole classification) —
 * consistent with "a partially-trustworthy result is still useful, a
 * fabricated one is not".
 */

export interface ReviewScoreDeps {
  outscraperFetch: OutscraperFetch;
  outscraperApiKey: string;
  anthropicFetch: AnthropicFetch;
  anthropicApiKey: string;
  reviewScoreModel: string;
  /** Injectable sleep for the Outscraper poll loop — tests pass a no-op so
   * the poll loop resolves instantly (same pattern as
   * `api-outreach-fetch-leads/handler.ts`'s `FetchLeadsDeps.sleep`). */
  sleep: (ms: number) => Promise<void>;
  logger: Logger;
  now?: Date;
}

export interface LeadNeedingReviewScoreRow {
  id: string;
  enrichment: Record<string, unknown>;
}

/** Task's own N=20-reviews-per-lead cost bound. */
export const PER_LEAD_REVIEWS_LIMIT = 20;
/** Per-run cap bounding a single cron invocation's total Outscraper spend
 * (BUILD_NOTES OUTREACH-2: hourly x 25 = 600 leads/day ceiling). */
export const PER_RUN_LEAD_CAP = 25;

// outscraper.com's own Google Maps Reviews API pricing page — same
// $3/1,000-past-free-tier rate as the Maps Search endpoint
// (api-outreach-fetch-leads/handler.ts's own OUTSCRAPER_COST_CENTS_PER_1000_RECORDS)
// billed per review actually returned (docs/VERIFY.md: page reached via a
// summarizing fetch, not raw byte inspection — re-confirm against a real
// invoice before relying on this for hard CAC numbers).
const OUTSCRAPER_REVIEWS_COST_CENTS_PER_1000 = 300;

// SYSTEM_DESIGN §3's own "~$0.02/lead" directional Anthropic-cost figure
// (same constant `job-outreach-personalize-collect/handler.ts` uses for
// its own per-lead hook-write call) — this job's classification call is a
// comparably-sized single short prompt, so the same directional estimate
// is reused rather than inventing a different unmeasured number.
const ESTIMATED_CLASSIFY_COST_CENTS_PER_LEAD = 2;

const POLL_ATTEMPTS = 5;
const POLL_DELAY_MS = 2000;

/** Selection query: a lead with a Google place id (captured into
 * `enrichment.google_place_id` at fetch time, `api-outreach-fetch-leads`)
 * that has never been analyzed. Oldest-first so a large backlog drains in
 * fetch order rather than the same newest leads winning every run. */
export async function findLeadsNeedingReviewScore(
  sql: SqlClient,
): Promise<LeadNeedingReviewScoreRow[]> {
  return sql<LeadNeedingReviewScoreRow>`
    select id, enrichment
    from public.leads
    where reviews_analyzed_at is null
      and enrichment ->> 'google_place_id' is not null
    order by created_at asc
    limit ${PER_RUN_LEAD_CAP}
  `;
}

function placeId(enrichment: Record<string, unknown>): string | null {
  const value = enrichment["google_place_id"];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function filterFabricatedEvidence(
  evidence: ReviewComplaintEvidence[],
  reviewTexts: string[],
): ReviewComplaintEvidence[] {
  return evidence.filter((e) => reviewTexts.some((text) => text.includes(e.snippet)));
}

export interface ScoreLeadResult {
  scored: boolean;
  skipped_reason?: "no_place_id" | "outscraper_failed" | "poll_timeout";
}

export async function scoreLeadReviews(
  sql: SqlClient,
  lead: LeadNeedingReviewScoreRow,
  deps: ReviewScoreDeps,
): Promise<ScoreLeadResult> {
  const now = deps.now ?? new Date();
  const pid = placeId(lead.enrichment);
  if (!pid) return { scored: false, skipped_reason: "no_place_id" };

  const start = await startGoogleMapsReviews(
    deps.outscraperFetch,
    deps.outscraperApiKey,
    [pid],
    PER_LEAD_REVIEWS_LIMIT,
  );
  if (!start.ok) {
    deps.logger.error("outreach_review_score_outscraper_start_failed", {
      lead_id: lead.id,
      status: start.status,
    });
    return { scored: false, skipped_reason: "outscraper_failed" };
  }

  let places: OutscraperPlaceReviews[] = [];
  let finished = false;
  if (start.places && start.places.length > 0) {
    places = start.places;
    finished = true;
  } else if (start.resultsLocation) {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
      await deps.sleep(POLL_DELAY_MS);
      const poll = await pollGoogleMapsReviews(
        deps.outscraperFetch,
        deps.outscraperApiKey,
        start.resultsLocation,
      );
      if (poll.finished) {
        places = poll.places;
        finished = true;
        break;
      }
    }
  } else {
    // No inline data and nothing to poll — Outscraper found the place but
    // returned no results_location at all; treat as a genuinely empty
    // review set rather than retrying forever.
    finished = true;
  }

  if (!finished) {
    deps.logger.warn("outreach_review_score_poll_timeout", { lead_id: lead.id });
    return { scored: false, skipped_reason: "poll_timeout" };
  }

  const reviewsWithText = (places[0]?.reviews_data ?? [])
    .filter((r) => typeof r.review_text === "string" && r.review_text.trim() !== "")
    .map((r) => ({
      text: r.review_text as string,
      ...(r.review_rating !== undefined ? { rating: r.review_rating } : {}),
      ...(r.review_datetime_utc ? { date: r.review_datetime_utc } : {}),
    }));

  if (reviewsWithText.length > 0) {
    const reviewsCostCents = Math.round(
      (reviewsWithText.length * OUTSCRAPER_REVIEWS_COST_CENTS_PER_1000) / 1000,
    );
    await recordPipelineCost(sql, {
      category: "review_scoring",
      amountCents: reviewsCostCents,
      occurredAt: now,
    });
  }

  let score: number | null = null;
  let evidence: ReviewComplaintEvidence[] = [];

  if (reviewsWithText.length > 0) {
    const call = await classifyPhoneComplaintScore(
      deps.anthropicFetch,
      deps.anthropicApiKey,
      deps.reviewScoreModel,
      reviewsWithText,
    );
    if (call.ok) {
      try {
        const raw = extractJsonObject(call.text);
        const parsed = ReviewScoreClassificationSchema.safeParse(raw);
        if (parsed.success) {
          score = parsed.data.score;
          evidence = filterFabricatedEvidence(
            parsed.data.evidence,
            reviewsWithText.map((r) => r.text),
          );
          await recordPipelineCost(sql, {
            category: "review_scoring",
            amountCents: ESTIMATED_CLASSIFY_COST_CENTS_PER_LEAD,
            occurredAt: now,
          });
        } else {
          deps.logger.warn("outreach_review_score_schema_mismatch", {
            lead_id: lead.id,
            issues: parsed.error.issues,
          });
        }
      } catch {
        deps.logger.warn("outreach_review_score_unparseable_response", { lead_id: lead.id });
      }
    } else {
      deps.logger.warn("outreach_review_score_classify_call_failed", { lead_id: lead.id });
    }
  } else {
    // No reviews at all for this place — a confident, real "no signal
    // found" rather than an unclassified one; nothing to invoke Anthropic
    // on, so no classification cost either.
    score = 0;
  }

  await sql`
    update public.leads
    set phone_complaint_score = ${score},
        phone_complaint_evidence = ${JSON.stringify(evidence)}::jsonb,
        reviews_analyzed_at = ${now.toISOString()}::timestamptz
    where id = ${lead.id}
  `;

  return { scored: true };
}

export async function runReviewScorePass(
  sql: SqlClient,
  deps: ReviewScoreDeps,
): Promise<{ leads_considered: number; scored: number; skipped: number }> {
  const leads = await findLeadsNeedingReviewScore(sql);
  let scored = 0;
  let skipped = 0;
  for (const lead of leads) {
    const result = await scoreLeadReviews(sql, lead, deps);
    if (result.scored) scored += 1;
    else skipped += 1;
  }
  return { leads_considered: leads.length, scored, skipped };
}
