import { findExistingLead, isSuppressed } from "../_shared/lead-dedup.ts";
import { recordCacEvent, recordPipelineCost } from "../_shared/outreach-cost.ts";
import type { ApolloFetch, ApolloPersonRecord } from "../_shared/providers/apollo.ts";
import { bulkEnrichOrganizations, searchPeople } from "../_shared/providers/apollo.ts";
import type { OutscraperFetch, OutscraperPlace } from "../_shared/providers/outscraper.ts";
import { pollGoogleMapsResults, startGoogleMapsSearch } from "../_shared/providers/outscraper.ts";
import type { FetchLeadsRequest } from "../_shared/schemas/outreach-fetch-leads.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/api-outreach-fetch-leads` (BACKEND_SPEC §1.8, T8 build step 1 / Flow 5
 * steps 1-2). Admin-only (checked by the Deno entrypoint, same
 * `platform_admin` claims check every `/admin-*` route uses — this is a
 * standalone function rather than folded into the `admin` router because
 * the task's own exclusive-paths list names it as a separate
 * `api-outreach-*` function).
 *
 * Apollo (people search, credit-free) for Apollo-strong verticals; Outscraper
 * (Google Maps, pay-per-record) for Apollo-weak ones (restaurant/motel) —
 * the CALLER picks `source` explicitly (MASTER_PLAN's per-vertical guidance
 * lives in the admin UI's default selection, not hard-coded here, so an
 * operator can still try either source for any vertical).
 *
 * Every candidate is deduped against `suppression_list` and existing
 * `leads` BEFORE insert (compliance rule: "suppression checked before
 * every lead add"); a candidate with neither email nor phone is dropped
 * before dedup entirely (API_AND_FLOWS.md A.5: "nothing to personalize
 * toward").
 */
export interface FetchLeadsDeps {
  apolloFetch: ApolloFetch;
  apolloApiKey: string;
  outscraperFetch: OutscraperFetch;
  outscraperApiKey: string;
  logger: Logger;
  now?: Date;
  /** Injectable sleep for the Outscraper poll loop (async scrape,
   * `results_location` may not be ready immediately) — tests pass a
   * no-op so the poll loop resolves instantly. */
  sleep: (ms: number) => Promise<void>;
}

interface NormalizedCandidate {
  companyName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  extra: Record<string, unknown>;
}

function fromApolloPerson(p: ApolloPersonRecord): NormalizedCandidate {
  const joinedName = [p.first_name, p.last_name].filter(Boolean).join(" ");
  const contactName = p.name ?? (joinedName || null);
  return {
    companyName: p.organization?.name ?? null,
    contactName,
    email: p.email ?? null,
    phone: null, // Apollo people search never returns phone without a separate enrichment call.
    website: p.organization?.website_url ?? p.organization?.primary_domain ?? null,
    extra: { title: p.title, city: p.city, state: p.state, email_status: p.email_status },
  };
}

function fromOutscraperPlace(p: OutscraperPlace): NormalizedCandidate {
  return {
    companyName: p.name ?? null,
    contactName: null,
    email: null, // Google Maps listings never carry an email address.
    phone: p.phone ?? p.phone_1 ?? null,
    website: p.site ?? null,
    extra: {
      full_address: p.full_address,
      category: p.category,
      rating: p.rating,
      // OUTREACH-2: captured so `job-outreach-review-score` has a place id
      // to fetch reviews for — Outscraper's own `/maps/search-v3` already
      // returns this per result row (see OutscraperPlace.place_id's own
      // docstring), it just wasn't kept anywhere before this task.
      ...(p.place_id ? { google_place_id: p.place_id } : {}),
    },
  };
}

// API_AND_FLOWS.md A.5: "~$3/1,000 records past a free tier" — a
// directional estimate to attribute (never invented past what that doc
// itself states), re-measure against the account's actual invoice before
// relying on this for hard CAC numbers (docs/VERIFY.md).
const OUTSCRAPER_COST_CENTS_PER_1000_RECORDS = 300;

const OUTSCRAPER_POLL_ATTEMPTS = 5;
const OUTSCRAPER_POLL_DELAY_MS = 2000;

export type FetchLeadsResult =
  | {
      status: 200;
      body: {
        source: string;
        inserted: number;
        skipped_suppressed: number;
        skipped_existing: number;
        skipped_no_contact: number;
      };
    }
  | { status: 502; body: { error: string } };

export async function handleFetchLeads(
  sql: SqlClient,
  req: FetchLeadsRequest,
  deps: FetchLeadsDeps,
): Promise<FetchLeadsResult> {
  const now = deps.now ?? new Date();
  let candidates: NormalizedCandidate[] = [];
  let listCostCents = 0;

  if (req.source === "apollo") {
    const searchResult = await searchPeople(deps.apolloFetch, deps.apolloApiKey, {
      ...(req.person_titles ? { personTitles: req.person_titles } : {}),
      ...(req.person_locations ? { personLocations: req.person_locations } : {}),
      ...(req.organization_domains ? { organizationDomains: req.organization_domains } : {}),
      ...(req.per_page ? { perPage: req.per_page } : {}),
    });
    if (!searchResult.ok) {
      deps.logger.error("outreach_fetch_leads_apollo_search_failed", {
        status: searchResult.status,
      });
      return { status: 502, body: { error: "apollo_search_failed" } };
    }
    candidates = searchResult.records.map(fromApolloPerson);
    // People Search is credit-free (API_AND_FLOWS.md A.5) — no list_cost for
    // the search step itself.

    if (req.enrich) {
      const domains = [
        ...new Set(candidates.map((c) => c.website).filter((w): w is string => Boolean(w))),
      ];
      const enrichResult = await bulkEnrichOrganizations(
        deps.apolloFetch,
        deps.apolloApiKey,
        domains,
      );
      // Failure handling per A.5: never block on a failed/partial
      // enrichment — merge whatever matched, leave the rest at
      // pre-enrichment fidelity.
      if (enrichResult.ok) {
        const byDomain = new Map(
          enrichResult.records
            .filter((r) => r.primary_domain)
            .map((r) => [r.primary_domain as string, r]),
        );
        for (const c of candidates) {
          const match = c.website ? byDomain.get(c.website) : undefined;
          if (match) {
            c.extra["employees"] = match.estimated_num_employees;
            c.extra["org_phone"] = match.phone;
            // Apollo credit-to-dollar conversion is plan-specific and not
            // fabricated here (A.5: "VERIFY current credit-to-dollar
            // conversion... before relying on this for the CAC dashboard")
            // — the enrichment fact is stored on the lead regardless;
            // no pipeline_costs/cac_events row is written for an unknown $
            // amount rather than guessing one.
          }
        }
      } else {
        deps.logger.warn("outreach_fetch_leads_apollo_enrich_failed", {
          status: enrichResult.status,
        });
      }
    }
  } else {
    const start = await startGoogleMapsSearch(
      deps.outscraperFetch,
      deps.outscraperApiKey,
      req.query,
      req.limit ?? 50,
    );
    if (!start.ok) {
      deps.logger.error("outreach_fetch_leads_outscraper_start_failed", { status: start.status });
      return { status: 502, body: { error: "outscraper_search_failed" } };
    }
    let places = start.places ?? [];
    if (places.length === 0 && start.resultsLocation) {
      for (let attempt = 0; attempt < OUTSCRAPER_POLL_ATTEMPTS; attempt++) {
        await deps.sleep(OUTSCRAPER_POLL_DELAY_MS);
        const poll = await pollGoogleMapsResults(
          deps.outscraperFetch,
          deps.outscraperApiKey,
          start.resultsLocation,
        );
        if (poll.finished) {
          places = poll.places;
          break;
        }
      }
    }
    candidates = places.map(fromOutscraperPlace);
    listCostCents = Math.round((candidates.length * OUTSCRAPER_COST_CENTS_PER_1000_RECORDS) / 1000);
  }

  let inserted = 0;
  let skippedSuppressed = 0;
  let skippedExisting = 0;
  let skippedNoContact = 0;
  const perLeadCostCents =
    candidates.length > 0 ? Math.round(listCostCents / candidates.length) : 0;

  for (const candidate of candidates) {
    if (!candidate.email && !candidate.phone) {
      skippedNoContact += 1;
      continue;
    }
    if (await isSuppressed(sql, { email: candidate.email, phone: candidate.phone })) {
      skippedSuppressed += 1;
      continue;
    }
    if (await findExistingLead(sql, { email: candidate.email, phone: candidate.phone })) {
      skippedExisting += 1;
      continue;
    }

    const enrichment = {
      ...candidate.extra,
      ...(candidate.website ? { website: candidate.website } : {}),
    };
    const insertedRows = await sql<{ id: string }>`
      insert into public.leads (source, vertical, company_name, contact_name, email, phone, enrichment)
      values (
        ${req.source}, ${req.vertical}, ${candidate.companyName}, ${candidate.contactName},
        ${candidate.email}, ${candidate.phone}, ${enrichment}::jsonb
      )
      returning id
    `;
    const leadId = insertedRows[0]?.id;
    if (leadId) {
      inserted += 1;
      if (perLeadCostCents > 0) {
        await recordCacEvent(sql, {
          channel: "cold_email",
          leadId,
          costCents: perLeadCostCents,
          occurredAt: now,
        });
      }
    }
  }

  if (listCostCents > 0) {
    await recordPipelineCost(sql, {
      category: "list_cost",
      amountCents: listCostCents,
      occurredAt: now,
    });
  }

  deps.logger.info("outreach_fetch_leads_complete", {
    source: req.source,
    vertical: req.vertical,
    inserted,
    skipped_suppressed: skippedSuppressed,
    skipped_existing: skippedExisting,
    skipped_no_contact: skippedNoContact,
  });

  return {
    status: 200,
    body: {
      source: req.source,
      inserted,
      skipped_suppressed: skippedSuppressed,
      skipped_existing: skippedExisting,
      skipped_no_contact: skippedNoContact,
    },
  };
}
