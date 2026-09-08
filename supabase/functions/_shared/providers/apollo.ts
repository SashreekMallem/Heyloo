/**
 * Apollo.io People/Organization Search + Enrichment via plain `fetch`
 * (API_AND_FLOWS.md A.5, T8 lead-fetch step). Primary lead source for
 * Apollo-strong verticals (legal, real_estate, auto, vet — MASTER_PLAN's
 * "blend per vertical" guidance).
 *
 * VERIFY (docs/VERIFY.md): re-diffed against Apollo's own official n8n
 * connector (`github.com/apolloio/n8n-nodes-apollo`,
 * `nodes/Apollo/Apollo.node.ts` — Apollo's integrations team, not a
 * community/third-party node), which is first-party Apollo source even
 * though `docs.apollo.io` itself is egress-blocked here. Two mismatches
 * from this build's earlier WebSearch-summary-sourced guesses were found
 * and fixed: (1) people search is `POST /mixed_people/search` (this
 * connector never calls an `api_search` variant at all — this build's
 * earlier "the plain /search path 403s on non-enterprise plans" claim
 * traced to an indexed third-party summary, not a first-party source, and
 * is now superseded by this official connector's own usage); (2) the
 * people-search filter field is `organization_domains`, not
 * `q_organization_domains_list`; (3) `organizations/bulk_enrich`'s body is
 * a flat `{domains: [...]}` array of domain strings, not `{details:
 * [{domain}, ...]}`. `X-Api-Key` header + `api.apollo.io/api/v1` base URL
 * were both independently confirmed via this connector's own
 * `credentials/ApolloApi.credentials.ts`. Response-body field names
 * (`people`/`organizations`/`pagination.total_entries`) are NOT confirmed
 * by this source (the n8n node passes the raw response through
 * unparsed) — still worth a live-sandbox confirm before relying on this
 * for real spend.
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
 * `POST /api/v1/mixed_people/search` (VERIFY-confirmed against Apollo's own
 * official n8n connector — see this file's header comment). Does NOT
 * return email/phone — those need a separate enrichment call, never
 * bundled here (credit cost is per-enrichment, not per-search).
 */
export async function searchPeople(
  fetchImpl: ApolloFetch,
  apiKey: string,
  params: ApolloPersonSearchParams,
): Promise<ApolloSearchResult<ApolloPersonRecord>> {
  const res = await fetchImpl(`${APOLLO_BASE_URL}/mixed_people/search`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "content-type": "application/json",
      "cache-control": "no-cache",
    },
    body: JSON.stringify({
      ...(params.personTitles ? { person_titles: params.personTitles } : {}),
      ...(params.personLocations ? { person_locations: params.personLocations } : {}),
      ...(params.organizationDomains ? { organization_domains: params.organizationDomains } : {}),
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
 * credit-metered (API_AND_FLOWS.md A.5). Body is a flat `{domains:
 * [...]}` array of domain strings (VERIFY-confirmed against Apollo's own
 * official n8n connector — this build's earlier `{details: [{domain}]}`
 * guess is fixed here). Failure handling per that doc: "enrichment
 * failures (no match found) leave the lead at its pre-enrichment fidelity
 * — never block the campaign-add step on a failed enrichment call" — this
 * returns whatever matched, callers merge onto the existing lead record
 * rather than treating a partial result as an error.
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
    body: JSON.stringify({ domains: domains.slice(0, 10) }),
  });
  if (!res.ok) return { ok: false, status: res.status, records: [] };
  const body = (await res.json().catch(() => undefined)) as
    | { organizations?: ApolloOrganizationRecord[] }
    | undefined;
  return { ok: true, status: res.status, records: body?.organizations ?? [] };
}
