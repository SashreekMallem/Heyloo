/**
 * Function-local Retell REST call (NOT added to `_shared/providers/
 * retell.ts` — that file is outside this cluster's ownership and every
 * other job/function in this repo already keeps single-purpose provider
 * calls function-local when they don't belong on the shared client, e.g.
 * `api-adapter-connect/handler.ts`'s own OAuth token-exchange calls). Only
 * `deletePhoneNumber` is needed here (Flow 8 step 2, G7: "Retell's agent is
 * un-imported from the number first, so no in-flight call is orphaned").
 *
 * RETELL-VERIFY (docs/VERIFY.md): confirmed against the official
 * `retell-sdk`/`retell-typescript-sdk` npm package source (`docs.retellai.com`
 * itself egress-blocked here, same fallback `_shared/providers/retell.ts`
 * documents) — `PhoneNumber.delete()` -> `DELETE /delete-phone-number/{phone_number}`,
 * same bearer-auth/base-URL convention as every other Retell call in this
 * repo. A 404 means the number was already deleted/un-imported (a prior
 * run's Twilio-release step succeeded but this call's own success record
 * didn't persist, or the number was never imported to begin with) —
 * treated as success so this idempotent job doesn't get stuck retrying a
 * call that has nothing left to do.
 */
export type RetellFetch = (input: string, init?: RequestInit) => Promise<Response>;

const RETELL_BASE_URL = "https://api.retellai.com";

export async function deleteRetellPhoneNumber(
  fetchImpl: RetellFetch,
  apiKey: string,
  e164: string,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetchImpl(
    `${RETELL_BASE_URL}/delete-phone-number/${encodeURIComponent(e164)}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${apiKey}` },
    },
  );
  return { ok: res.ok || res.status === 404, status: res.status };
}
