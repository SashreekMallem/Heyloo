/**
 * Airtable REST API push (BACKEND_SPEC §10.3/§10.4) — the Airtable adapter
 * requested via `docs/audit/FIX_REQUESTS.md` (cluster C: "request the
 * worker from cluster E" — `worker-adapter-push/handler.ts`'s
 * `ADAPTER_PUSHERS` map had no Airtable branch at all, so every message the
 * dashboard's Airtable "sync now" action enqueues logs
 * `adapter_push_not_implemented` and goes nowhere). One-way push only
 * (Heyloo -> tenant's Airtable base), matching every other T7 adapter in
 * this codebase — `apps/web`'s own OAuth2+PKCE connect flow
 * (`apps/web/src/app/api/tenant/delivery/airtable/**`, a different
 * cluster's work, outside this cluster's ownership) is what actually
 * populates `adapter_connections` with `provider: 'airtable'`; this file is
 * only the outbound push half.
 *
 * VERIFY (docs/VERIFY.md): `airtable.com/developers/web/api` was egress-
 * blocked in this build (same as this codebase's other Airtable OAuth
 * work) — the record create/update shape below is a training-knowledge-
 * confident, long-stable Airtable Web API convention
 * (`{fields: {...}, typecast: true}`), not a first-party fetch.
 */

const AIRTABLE_BASE_URL = "https://api.airtable.com/v0";

export type AirtableFetch = (input: string, init?: RequestInit) => Promise<Response>;

async function airtableRequest(
  fetchImpl: AirtableFetch,
  accessToken: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetchImpl(`${AIRTABLE_BASE_URL}${path}`, {
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

export async function createAirtableRecord(
  fetchImpl: AirtableFetch,
  accessToken: string,
  params: { baseId: string; tableIdOrName: string; fields: Record<string, unknown> },
) {
  return airtableRequest(
    fetchImpl,
    accessToken,
    "POST",
    `/${params.baseId}/${encodeURIComponent(params.tableIdOrName)}`,
    { fields: params.fields, typecast: true },
  );
}

export async function updateAirtableRecord(
  fetchImpl: AirtableFetch,
  accessToken: string,
  params: {
    baseId: string;
    tableIdOrName: string;
    recordId: string;
    fields: Record<string, unknown>;
  },
) {
  return airtableRequest(
    fetchImpl,
    accessToken,
    "PATCH",
    `/${params.baseId}/${encodeURIComponent(params.tableIdOrName)}/${params.recordId}`,
    { fields: params.fields, typecast: true },
  );
}
