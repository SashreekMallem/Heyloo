/**
 * ezyVet webhook coverage for appointment changes is unconfirmed
 * (API_AND_FLOWS.md A.6 explicitly flags this: "ezyVet's webhook coverage
 * for appointment changes specifically needs confirmation" and
 * VERTICAL_RESEARCH.md already names ezyVet as one of the providers where
 * two-way sync likely needs POLLING, not webhooks — BACKEND_SPEC §7.6's own
 * table marks the fallback as "poll-back on a schedule ... if no
 * cancellation webhook exists"). Rather than invent a signature scheme
 * with false confidence, `handleWebhook` always fails closed with an
 * explicit "not supported" reason — the real two-way sync path is
 * `pullChanges` (sync.ts), which worker-adapter-push's poll job (BACKEND_
 * SPEC §8) is expected to call on a schedule for this adapter specifically.
 */

import type { HandleWebhookResult } from "./adapter-types.js";

export function handleEzyVetWebhook(): HandleWebhookResult {
  return { valid: false, reason: "ezyvet_webhook_scheme_unconfirmed_use_poll_sync" };
}
