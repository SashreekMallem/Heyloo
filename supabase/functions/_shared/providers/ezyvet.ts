/**
 * ezyVet REST calls (BACKEND_SPEC §7.6, API_AND_FLOWS.md A.6 "ezyVet
 * (veterinary)"). Portable — plain `fetch`, mirroring `packages/adapters/
 * ezyvet`'s Node package logic (documented intentional duplication — Deno
 * can't import a pnpm workspace package here). Each connection carries its
 * own `metadata.baseUrl`; CONNECT-SAFE-1 limits it to ezyVet's documented
 * API hosts (`isEzyVetApiUrl`, `isEzyVetDomainUrl` below).
 *
 * No `handleWebhook` here — ezyVet's webhook coverage for appointment
 * changes is unconfirmed (API_AND_FLOWS.md A.6, VERTICAL_RESEARCH.md), so
 * `webhooks-pos/index.ts` never routes `provider=ezyvet` to a signature
 * verifier at all; two-way sync for this adapter is poll-only
 * (`pollEzyVetChanges` below, called from worker-adapter-push's poller).
 *
 * VERIFY (docs/VERIFY.md): `developers.ezyvet.com` was egress-blocked in
 * the original build; only the API hosts have been confirmed since
 * (CONNECT-SAFE-1). Every endpoint/field below is still a hypothesis.
 */

export const EZYVET_RATE_LIMIT_PER_MINUTE = 180;
/** 12h TTL per API_AND_FLOWS.md A.6; refresh proactively at the 10h mark
 * (2h margin) rather than reactively on first 401. */
export const EZYVET_PROACTIVE_REFRESH_MARGIN_SECONDS = 2 * 60 * 60;

export type EzyVetFetch = (input: string, init?: RequestInit) => Promise<Response>;

async function ezyVetRequest(
  fetchImpl: EzyVetFetch,
  baseUrl: string,
  accessToken: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  // Customer data and the access token never leave for a non-ezyVet host —
  // polling and a far-future `expires_at` skip the token refresh entirely,
  // so that guard alone would not cover a stored foreign `metadata.baseUrl`.
  if (!isEzyVetDomainUrl(baseUrl)) return { ok: false, status: 0, body: undefined };
  const res = await fetchImpl(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const parsedBody = await res.json().catch(() => undefined);
  return { ok: res.ok, status: res.status, body: parsedBody };
}

/**
 * ezyVet's documented API servers (developers.ezyvet.com "Servers", fetched
 * 2026-10-09): production `https://api.ezyvet.com`, trial
 * `https://api.trial.ezyvet.com`; token URL
 * `https://api.ezyvet.com/v1/oauth/access_token`.
 */
const EZYVET_API_HOSTS: ReadonlySet<string> = new Set(["api.ezyvet.com", "api.trial.ezyvet.com"]);

/** An https URL with the default port and no userinfo, else null. */
function plainHttpsUrl(baseUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return null;
  return url;
}

/**
 * CONNECT-SAFE-1: true only for one of ezyVet's two documented API hosts
 * (https, default port, no userinfo). The gate for anything that carries our
 * partner `client_secret` (the token mint) and for a new connect's
 * `base_url` — an exact allowlist, not a domain suffix, so no other
 * `*.ezyvet.com` host (support, status or marketing sites are often
 * third-party hosted) can receive or redirect the secret. VERIFY.md SSRF-1:
 * it used to go to whatever https host a tenant typed.
 */
export function isEzyVetApiUrl(baseUrl: string): boolean {
  const url = plainHttpsUrl(baseUrl);
  return url !== null && EZYVET_API_HOSTS.has(url.hostname);
}

/**
 * Looser gate for the bearer-token data calls (`ezyVetRequest`): any https
 * host on ezyVet's own domain, so rows stored with the older per-practice
 * `{practice}.ezyvet.com` shape keep working until their next token refresh
 * (which `isEzyVetApiUrl` then refuses). Never a foreign host.
 */
export function isEzyVetDomainUrl(baseUrl: string): boolean {
  const url = plainHttpsUrl(baseUrl);
  if (url === null) return false;
  return url.hostname === "ezyvet.com" || url.hostname.endsWith(".ezyvet.com");
}

export async function refreshEzyVetToken(
  fetchImpl: EzyVetFetch,
  baseUrl: string,
  params: { clientId: string; clientSecret: string; partnerId: string },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  // Refused without any network call: a stored `metadata.baseUrl` from
  // before this guard is still read by worker-adapter-push on every refresh.
  // Redirects are the caller's fetch policy (BUILD_NOTES CONNECT-SAFE-1: the
  // worker must pass a `maxRedirects: 0` safe fetch before ezyVet is enabled).
  if (!isEzyVetApiUrl(baseUrl)) return { ok: false, status: 0, body: undefined };
  const res = await fetchImpl(`${baseUrl}/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: params.clientId,
      client_secret: params.clientSecret,
      partner_id: params.partnerId,
    }).toString(),
  });
  const body = await res.json().catch(() => undefined);
  return { ok: res.ok, status: res.status, body };
}

export function shouldRefreshEzyVetAuth(
  expiresAt: string | null | undefined,
  now = () => Date.now(),
): boolean {
  if (!expiresAt) return true;
  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) return true;
  return expiresAtMs - now() <= EZYVET_PROACTIVE_REFRESH_MARGIN_SECONDS * 1000;
}

export async function listEzyVetAppointmentTypes(
  fetchImpl: EzyVetFetch,
  baseUrl: string,
  accessToken: string,
) {
  return ezyVetRequest(fetchImpl, baseUrl, accessToken, "GET", "/appointmenttype");
}

export async function findEzyVetContactByPhone(
  fetchImpl: EzyVetFetch,
  baseUrl: string,
  accessToken: string,
  mobile: string,
) {
  const query = new URLSearchParams({ mobile });
  return ezyVetRequest(fetchImpl, baseUrl, accessToken, "GET", `/contact?${query.toString()}`);
}

export async function createEzyVetContact(
  fetchImpl: EzyVetFetch,
  baseUrl: string,
  accessToken: string,
  params: { firstName: string; lastName: string; mobile: string; email?: string | undefined },
) {
  return ezyVetRequest(fetchImpl, baseUrl, accessToken, "POST", "/contact", {
    first_name: params.firstName,
    last_name: params.lastName,
    mobile: params.mobile,
    ...(params.email ? { email: params.email } : {}),
  });
}

export async function createEzyVetAppointment(
  fetchImpl: EzyVetFetch,
  baseUrl: string,
  accessToken: string,
  params: {
    contactId: string;
    physicalResourceId?: string | undefined;
    appointmentTypeId?: string | undefined;
    startAt: string;
    endAt: string;
    notes?: string | undefined;
    idempotencyKey: string;
  },
) {
  return ezyVetRequest(fetchImpl, baseUrl, accessToken, "POST", "/appointment", {
    contact_id: params.contactId,
    physical_resource_id: params.physicalResourceId,
    appointment_type_id: params.appointmentTypeId,
    start_time: params.startAt,
    end_time: params.endAt,
    description: params.notes ?? "",
    reference: params.idempotencyKey,
  });
}

export async function listEzyVetAppointmentChanges(
  fetchImpl: EzyVetFetch,
  baseUrl: string,
  accessToken: string,
  modifiedAfter?: string,
) {
  const query = new URLSearchParams(modifiedAfter ? { modified_date_from: modifiedAfter } : {});
  return ezyVetRequest(fetchImpl, baseUrl, accessToken, "GET", `/appointment?${query.toString()}`);
}
