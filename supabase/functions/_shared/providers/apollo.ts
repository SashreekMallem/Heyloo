/**
 * Apollo.io People/Organization Search + Enrichment via plain `fetch`
 * (API_AND_FLOWS.md A.5, T8 lead-fetch step). Primary lead source for
 * Apollo-strong verticals (legal, real_estate, auto, vet — MASTER_PLAN's
 * "blend per vertical" guidance).
 *
 * VERIFY (docs/VERIFY.md): `docs.apollo.io` returned EGRESS_BLOCKED to
 * WebFetch in this build (CLAUDE.md Rule 1 item 2) — endpoint paths and
 * field names below come from WebSearch-indexed summaries of Apollo's own
 * current developer docs (Rule 1 item 2's documented fallback), not from
 * memory. Re-confirm against a live Apollo account/sandbox before relying
 * on this for real spend: People Search is credit-free; org enrichment
 * consumes credits per the account's plan.
 */

const APOLLO_BASE_URL = "https://api.apollo.io/api/v1";

export type ApolloFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApolloPersonSearchParams {
  personTitles?: string[];
  personLocations?: string[];
  organizationDomains?: string[];
  perPage?: number;
  page?: number;
}

export interface ApolloOrganizationRef {
  name?: string;
  website_url?: string;
  primary_domain?: string;
}

export interface ApolloPersonRecord {
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  email?: string;
  email_status?: string;
  organization?: ApolloOrganizationRef;
  city?: string;
  state?: string;
}

export interface ApolloSearchResult<T> {
  ok: boolean;
  status: number;
  records: T[];
  totalEntries?: number;
}

/**
 * `POST /api/v1/mixed_people/api_search` — the API-usage-optimized search
 * endpoint (VERIFY: the older `/mixed_people/search` path 403s on non-
 * enterprise plans per the indexed docs summary, so this uses the
 * `api_search` variant deliberately). Does NOT return email/phone — those
 * need a separate enrichment call, never bundled here (credit cost is
 * per-enrichment, not per-search).
 */
export async function searchPeople(
  fetchImpl: ApolloFetch,
  apiKey: string,
  params: ApolloPersonSearchParams,
): Promise<ApolloSearchResult<ApolloPersonRecord>> {
  const res = await fetchImpl(`${APOLLO_BASE_URL}/mixed_people/api_search`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "content-type": "application/json",
      "cache-control": "no-cache",
    },
    body: JSON.stringify({
      ...(params.personTitles ? { person_titles: params.personTitles } : {}),
      ...(params.personLocations ? { person_locations: params.personLocations } : {}),
      ...(params.organizationDomains
        ? { q_organization_domains_list: params.organizationDomains }
        : {}),
      per_page: params.perPage ?? 25,
      page: params.page ?? 1,
    }),
  });
  if (!res.ok) return { ok: false, status: res.status, records: [] };
  const body = (await res.json().catch(() => undefined)) as
    | { people?: ApolloPersonRecord[]; pagination?: { total_entries?: number } }
    | undefined;
  return {
    ok: true,
    status: res.status,
    records: body?.people ?? [],
    ...(body?.pagination?.total_entries !== undefined
      ? { totalEntries: body.pagination.total_entries }
      : {}),
  };
}

export interface ApolloOrganizationSearchParams {
  organizationLocations?: string[];
  perPage?: number;
  page?: number;
}

export interface ApolloOrganizationRecord {
  name?: string;
  website_url?: string;
  primary_domain?: string;
  phone?: string;
  estimated_num_employees?: number;
}

/** `POST /api/v1/mixed_companies/search` — for Apollo-strong verticals
 * where searching by organization (not a named contact) is the entry
 * point (e.g. legal firms, auto repair shops). */
export async function searchOrganizations(
  fetchImpl: ApolloFetch,
  apiKey: string,
  params: ApolloOrganizationSearchParams,
): Promise<ApolloSearchResult<ApolloOrganizationRecord>> {
  const res = await fetchImpl(`${APOLLO_BASE_URL}/mixed_companies/search`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "content-type": "application/json",
      "cache-control": "no-cache",
    },
    body: JSON.stringify({
      ...(params.organizationLocations
        ? { organization_locations: params.organizationLocations }
        : {}),
      per_page: params.perPage ?? 25,
      page: params.page ?? 1,
    }),
  });
  if (!res.ok) return { ok: false, status: res.status, records: [] };
  const body = (await res.json().catch(() => undefined)) as
    | { organizations?: ApolloOrganizationRecord[]; pagination?: { total_entries?: number } }
    | undefined;
  return {
    ok: true,
    status: res.status,
    records: body?.organizations ?? [],
    ...(body?.pagination?.total_entries !== undefined
      ? { totalEntries: body.pagination.total_entries }
      : {}),
  };
}

/**
 * `POST /api/v1/organizations/bulk_enrich` — up to 10 companies/call,
 * credit-metered (API_AND_FLOWS.md A.5). Failure handling per that doc:
 * "enrichment failures (no match found) leave the lead at its
 * pre-enrichment fidelity — never block the campaign-add step on a failed
 * enrichment call" — this returns whatever matched, callers merge onto the
 * existing lead record rather than treating a partial result as an error.
 */
export async function bulkEnrichOrganizations(
  fetchImpl: ApolloFetch,
  apiKey: string,
  domains: string[],
): Promise<ApolloSearchResult<ApolloOrganizationRecord>> {
  if (domains.length === 0) return { ok: true, status: 200, records: [] };
  const res = await fetchImpl(`${APOLLO_BASE_URL}/organizations/bulk_enrich`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "content-type": "application/json",
      "cache-control": "no-cache",
    },
    body: JSON.stringify({ details: domains.slice(0, 10).map((domain) => ({ domain })) }),
  });
  if (!res.ok) return { ok: false, status: res.status, records: [] };
  const body = (await res.json().catch(() => undefined)) as
    | { organizations?: ApolloOrganizationRecord[] }
    | undefined;
  return { ok: true, status: res.status, records: body?.organizations ?? [] };
}
