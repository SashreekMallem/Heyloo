import type { RetellFetch } from "../retell.ts";
import { deletePhoneNumber, getPhoneNumber, listPhoneNumbersPage } from "../retell.ts";
import type {
  FailoverSupport,
  NumberRecord,
  PhoneNumberProvider,
  ReleaseResult,
  RoutingCapture,
  RoutingChange,
} from "./types.ts";

export interface RetellNumberDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  /** Agent ids that must never be detached from a number by a lifecycle job
   * (the shared demo agent, `DEMO_AGENT_ID`). A number whose agent bindings
   * include one is refused, never deleted. */
  protectedAgentIds: readonly string[];
}

/** delete-phone-number documents 422 "Cannot find requested asset"; the
 * get-phone-number page documents 422 only as the generic "Unprocessable
 * Content" (and no 404). Neither status is proof of absence on its own, so a
 * 404/422 is always confirmed against the list endpoint (`findListed`). */
function isGoneStatus(status: number): boolean {
  return status === 404 || status === 422;
}

const LIST_MAX_PAGES = 20;

/**
 * Looks the number up in the account's number list (paginated). `entry` is
 * the list item when the number still exists (it carries the agent bindings)
 * and null when the whole list was read and it is absent. Any list failure is
 * a failure, never "absent": absence is only ever concluded from a complete,
 * successful read.
 */
async function findListed(
  deps: RetellNumberDeps,
  e164: string,
): Promise<{ ok: true; entry: unknown | null } | { ok: false; status: number }> {
  let paginationKey: string | undefined;
  for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
    const res = await listPhoneNumbersPage(deps.retellFetch, deps.retellApiKey, {
      ...(paginationKey ? { paginationKey } : {}),
    });
    const body = res.body as
      | { items?: unknown; has_more?: unknown; pagination_key?: unknown }
      | undefined;
    if (!res.ok || !Array.isArray(body?.items)) return { ok: false, status: res.status || 502 };
    const hit = body.items.find(
      (item) => (item as { phone_number?: unknown } | null)?.phone_number === e164,
    );
    if (hit !== undefined) return { ok: true, entry: hit };
    if (body.has_more !== true) return { ok: true, entry: null };
    if (typeof body.pagination_key !== "string" || body.pagination_key === "") {
      return { ok: false, status: 502 };
    }
    paginationKey = body.pagination_key;
  }
  return { ok: false, status: 502 };
}

function boundAgentIds(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const ids: string[] = [];
  for (const key of [
    "inbound_agents",
    "outbound_agents",
    "inbound_sms_agents",
    "outbound_sms_agents",
  ]) {
    const list = (body as Record<string, unknown>)[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const id = (entry as { agent_id?: unknown } | null)?.agent_id;
      if (typeof id === "string") ids.push(id);
    }
  }
  return ids;
}

/**
 * Release a number in Retell (`DELETE /delete-phone-number/{e164}`; for a
 * Retell-purchased number this also releases it at the carrier and stops the
 * monthly charge; for an imported number it un-imports it). Idempotent and
 * scoped to exactly this one E.164 — it never lists or bulk-deletes.
 *
 * Read first (`GET /get-phone-number`): a number Retell no longer has is a
 * completed release (retried run), and a number bound to a protected agent
 * is refused. 404/422 (on the GET or the DELETE) is never trusted on its
 * own: the number counts as gone only when the paginated list-phone-numbers
 * read succeeds and does not contain it; a listed number is still checked
 * against protected agents and deleted.
 */
export async function releaseRetellNumber(
  deps: RetellNumberDeps,
  e164: string,
): Promise<
  | { ok: true; alreadyReleased: boolean }
  | { ok: false; reason: "retell_delete_failed" | "protected_agent_bound"; status: number }
> {
  const current = await getPhoneNumber(deps.retellFetch, deps.retellApiKey, e164);
  let body: unknown = current.body;
  if (isGoneStatus(current.status)) {
    const listed = await findListed(deps, e164);
    if (!listed.ok) return { ok: false, reason: "retell_delete_failed", status: listed.status };
    if (listed.entry === null) return { ok: true, alreadyReleased: true };
    body = listed.entry;
  } else if (!current.ok) {
    return { ok: false, reason: "retell_delete_failed", status: current.status };
  }

  const protectedIds = new Set(deps.protectedAgentIds.filter((id) => id !== ""));
  if (boundAgentIds(body).some((id) => protectedIds.has(id))) {
    return { ok: false, reason: "protected_agent_bound", status: current.status };
  }

  const deleted = await deletePhoneNumber(deps.retellFetch, deps.retellApiKey, e164);
  if (deleted.ok) return { ok: true, alreadyReleased: false };
  if (isGoneStatus(deleted.status)) {
    const listed = await findListed(deps, e164);
    if (listed.ok && listed.entry === null) return { ok: true, alreadyReleased: true };
  }
  return { ok: false, reason: "retell_delete_failed", status: deleted.status };
}

const NO_FAILOVER_REASON =
  "retell_native_number: routing lives entirely inside Retell (no Twilio/SIP resource we control), " +
  "so calls cannot be diverted away from Retell during a Retell outage";

/**
 * Adapter for numbers bought through Retell (or an existing Retell-account
 * number). Failover is unsupported by design: `update-phone-number` only
 * exposes agent bindings, `inbound_webhook_url` (a per-call override Retell
 * itself must be up to call) and `fallback_number` (documented as the
 * concurrency-overflow target only), none of which reroutes calls when
 * Retell is down.
 */
export function createRetellNativeProvider(deps: RetellNumberDeps): PhoneNumberProvider {
  return {
    id: "retell-native",
    failoverSupport(): FailoverSupport {
      return { supported: false, reason: NO_FAILOVER_REASON };
    },
    async release(number: NumberRecord): Promise<ReleaseResult> {
      return releaseRetellNumber(deps, number.e164);
    },
    // Never reached by the health-failover job (it checks `failoverSupport`
    // first); fail loudly rather than pretend, if a future caller does.
    async captureRouting(): Promise<RoutingCapture> {
      return { ok: false, status: 501 };
    },
    async divertRouting(): Promise<RoutingChange> {
      return { ok: false, status: 501 };
    },
    async restoreRouting(): Promise<RoutingChange> {
      return { ok: false, status: 501 };
    },
  };
}
