import { retrieveBalanceTransaction, type StripeFetch } from "../_shared/providers/stripe.ts";
import type { BalanceTransactionFee } from "./billing.ts";

/**
 * Real fee/net for a charge (SIGNUP-BILL-FIX E): `GET /v1/balance_transactions/{id}`.
 * `fee` and `net` are integers in the smallest currency unit (docs.stripe.com/
 * api/balance_transactions/object, fetched 2026-09-29). Returns null on any
 * failure so the caller defers the event instead of recording a wrong fee.
 */
export function createFetchBalanceTransaction(config: {
  secretKey: string | undefined;
  fetchImpl?: StripeFetch;
}): ((id: string) => Promise<BalanceTransactionFee | null>) | undefined {
  const { secretKey } = config;
  if (!secretKey) return undefined;
  const doFetch: StripeFetch = config.fetchImpl ?? fetch;
  return async (id) => {
    try {
      const res = await retrieveBalanceTransaction(doFetch, secretKey, id);
      const body = res.body as { fee?: unknown; net?: unknown; currency?: unknown } | undefined;
      if (
        !res.ok ||
        !body ||
        typeof body.fee !== "number" ||
        !Number.isInteger(body.fee) ||
        typeof body.net !== "number" ||
        !Number.isInteger(body.net)
      ) {
        return null;
      }
      return {
        feeCents: body.fee,
        netCents: body.net,
        currency: typeof body.currency === "string" ? body.currency : null,
      };
    } catch {
      return null;
    }
  };
}
