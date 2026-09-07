/**
 * ezyVet REST calls (BACKEND_SPEC §7.6, API_AND_FLOWS.md A.6 "ezyVet
 * (veterinary)"). Portable — plain `fetch`, mirroring `packages/adapters/
 * ezyvet`'s Node package logic (documented intentional duplication — Deno
 * can't import a pnpm workspace package here). Each connection carries its
 * OWN base URL (the practice's ezyVet database subdomain) rather than one
 * shared host, unlike Square/Google.
 *
 * No `handleWebhook` here — ezyVet's webhook coverage for appointment
 * changes is unconfirmed (API_AND_FLOWS.md A.6, VERTICAL_RESEARCH.md), so
 * `webhooks-pos/index.ts` never routes `provider=ezyvet` to a signature
 * verifier at all; two-way sync for this adapter is poll-only
 * (`pollEzyVetChanges` below, called from worker-adapter-push's poller).
 *
 * VERIFY (docs/VERIFY.md): `developers.ezyvet.com` was egress-blocked in
 * this build; every endpoint/field below is a documented hypothesis.
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

export async function refreshEzyVetToken(
  fetchImpl: EzyVetFetch,
  baseUrl: string,
  params: { clientId: string; clientSecret: string; partnerId: string },
) {
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
