import {
  claimDeliveryById,
  processClaimedDelivery,
  type WebhookDeliveryDeps,
} from "../_shared/outbound/delivery.ts";
import { generateSigningSecret } from "../_shared/outbound/secret.ts";
import { assertPublicUrl, type DnsResolver, SafeFetchError } from "../_shared/safe-fetch.ts";
import {
  OUTBOUND_EVENT_TYPES,
  OUTBOUND_MAX_DESTINATIONS,
  type TenantWebhooksRequest,
} from "../_shared/schemas/outbound-webhooks.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/api-tenant-webhooks` (OUTBOUND-1, docs/BUILD_NOTES.md): the owner's
 * outbound webhook destinations — create / update / delete / rotate_secret /
 * send_test / retry. The dashboard (Integrations page) calls it through the
 * `/api/tenant/webhooks` Next.js route with the tenant session's JWT.
 *
 * Rule 2: the tenant comes ONLY from the verified JWT's `app_metadata`
 * (verify_jwt = true in config.toml; `authorizeTenantWebhooksCaller` below),
 * never from the body, and EVERY statement here filters by that tenant_id
 * explicitly even though this connection bypasses RLS. Owner/admin only (all
 * actions write); an impersonating admin without edit rights is refused.
 *
 * The signing secret is returned exactly twice in a destination's life: in
 * the `create` response and in a `rotate_secret` response. It is stored only
 * in Supabase Vault; the destination row holds its Vault id, which is never
 * returned.
 */

export interface TenantWebhooksDeps {
  logger: Logger;
  /** Same engine the worker uses, for "Send test". */
  delivery: WebhookDeliveryDeps;
  /** DNS resolver for the up-front public-URL check (default: `Deno.resolveDns`). */
  resolver?: DnsResolver | null;
  generateSecret?: () => string;
}

export type TenantWebhooksResult = { status: number; body: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Authorization (claims are already signature-verified by the platform)
// ---------------------------------------------------------------------------

export interface TenantWebhooksClaims {
  app_metadata?: {
    tenant_id?: unknown;
    role?: unknown;
    impersonated_by?: unknown;
    impersonation_edit_enabled?: unknown;
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function authorizeTenantWebhooksCaller(
  claims: TenantWebhooksClaims | null,
): { ok: true; tenantId: string } | { ok: false } {
  const meta = claims?.app_metadata;
  const tenantId = meta?.tenant_id;
  if (typeof tenantId !== "string" || !UUID.test(tenantId)) return { ok: false };
  if (meta?.role !== "owner" && meta?.role !== "admin") return { ok: false };
  // Same read-only rule the RLS write policies apply to impersonated sessions.
  const impersonating = typeof meta.impersonated_by === "string" && meta.impersonated_by !== "";
  if (impersonating && meta.impersonation_edit_enabled !== true) return { ok: false };
  return { ok: true, tenantId };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Public columns only: never `signing_secret_id`. */
interface DestinationRow {
  id: string;
  name: string;
  url: string;
  event_types: string[];
  enabled: boolean;
  disabled_reason: string | null;
  consecutive_failures: number;
  last_success_at: Date | string | null;
  last_failure_at: Date | string | null;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const URL_REJECTION_MESSAGES: Partial<Record<SafeFetchError["code"], string>> = {
  dns_failed: "We couldn't find that web address. Check it for typos.",
  port_not_allowed: "Use a standard https:// address without a port number.",
  userinfo_not_allowed: "Remove the user name and password from the address.",
};

/** Up-front SSRF check (the send path re-checks every time). Null when allowed. */
async function rejectUrl(
  url: string,
  resolver: DnsResolver | null | undefined,
): Promise<string | null> {
  try {
    await (resolver === undefined ? assertPublicUrl(url) : assertPublicUrl(url, resolver));
    return null;
  } catch (err) {
    if (!(err instanceof SafeFetchError)) throw err;
    return (
      URL_REJECTION_MESSAGES[err.code] ??
      "That address isn't allowed. Use a public https:// address from your app (Zapier, Make, n8n, ...)."
    );
  }
}

function isLimitError(err: unknown): boolean {
  const e = err as { message?: unknown; hint?: unknown } | null;
  return (
    e?.hint === "outbound_destination_limit" ||
    (typeof e?.message === "string" && e.message.includes("outbound destination limit"))
  );
}

/** The table's own URL CHECK fired. The request schema normalizes URLs so
 * this should never happen; if the two ever drift, the owner still gets a
 * 422 they can act on instead of a 500. */
function isUrlCheckViolation(err: unknown): boolean {
  const e = err as { code?: unknown; constraint_name?: unknown } | null;
  return e?.code === "23514" && e?.constraint_name === "outbound_destinations_url_chk";
}

const URL_CHECK_MESSAGE = "Enter a web address that starts with https:// (no spaces).";

const notFound = (): TenantWebhooksResult => ({ status: 404, body: { error: "not_found" } });

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function createDestination(
  sql: SqlClient,
  tenantId: string,
  req: Extract<TenantWebhooksRequest, { action: "create" }>,
  deps: TenantWebhooksDeps,
): Promise<TenantWebhooksResult> {
  const urlError = await rejectUrl(req.url, deps.resolver);
  if (urlError) return { status: 422, body: { error: "url_not_allowed", message: urlError } };

  const counted = await sql<{ n: number }>`
    select count(*)::int as n from public.outbound_destinations where tenant_id = ${tenantId}
  `;
  if ((counted[0]?.n ?? 0) >= OUTBOUND_MAX_DESTINATIONS) {
    return { status: 409, body: { error: "destination_limit", limit: OUTBOUND_MAX_DESTINATIONS } };
  }

  const secret = (deps.generateSecret ?? generateSigningSecret)();
  const eventTypes = req.event_types ?? [...OUTBOUND_EVENT_TYPES];
  let rows: DestinationRow[];
  try {
    // One statement: the Vault secret and the row are created together or not at all.
    rows = await sql<DestinationRow>`
      insert into public.outbound_destinations (tenant_id, name, url, event_types, signing_secret_id)
      values (${tenantId}, ${req.name}, ${req.url}, ${eventTypes}::text[],
        public.fn_outbound_secret_create(${secret}))
      returning id, name, url, event_types, enabled, disabled_reason, consecutive_failures,
        last_success_at, last_failure_at, last_error, created_at, updated_at
    `;
  } catch (err) {
    if (isLimitError(err)) {
      return {
        status: 409,
        body: { error: "destination_limit", limit: OUTBOUND_MAX_DESTINATIONS },
      };
    }
    if (isUrlCheckViolation(err)) {
      return { status: 422, body: { error: "url_not_allowed", message: URL_CHECK_MESSAGE } };
    }
    throw err;
  }
  const destination = rows[0];
  if (!destination) throw new Error("outbound_destination_insert_returned_nothing");
  deps.logger.info("outbound_destination_created", {
    tenant_id: tenantId,
    destination_id: destination.id,
  });
  return { status: 200, body: { destination, signing_secret: secret } };
}

async function updateDestination(
  sql: SqlClient,
  tenantId: string,
  req: Extract<TenantWebhooksRequest, { action: "update" }>,
  deps: TenantWebhooksDeps,
): Promise<TenantWebhooksResult> {
  if (req.url !== undefined) {
    const urlError = await rejectUrl(req.url, deps.resolver);
    if (urlError) return { status: 422, body: { error: "url_not_allowed", message: urlError } };
  }
  const name = req.name ?? null;
  const url = req.url ?? null;
  const eventTypes = req.event_types ?? null;
  const enabled = req.enabled ?? null;
  // Turning a destination on clears why it was off and its failure streak;
  // turning it off records that the owner did it.
  let rows: DestinationRow[];
  try {
    rows = await sql<DestinationRow>`
      update public.outbound_destinations
      set name = coalesce(${name}::text, name),
          url = coalesce(${url}::text, url),
          event_types = coalesce(${eventTypes}::text[], event_types),
          enabled = coalesce(${enabled}::boolean, enabled),
          disabled_reason = case
            when ${enabled}::boolean is null then disabled_reason
            when ${enabled}::boolean then null
            else 'owner'
          end,
          consecutive_failures = case
            when ${enabled}::boolean is true then 0
            else consecutive_failures
          end
      where id = ${req.id} and tenant_id = ${tenantId}
      returning id, name, url, event_types, enabled, disabled_reason, consecutive_failures,
        last_success_at, last_failure_at, last_error, created_at, updated_at
    `;
  } catch (err) {
    if (isUrlCheckViolation(err)) {
      return { status: 422, body: { error: "url_not_allowed", message: URL_CHECK_MESSAGE } };
    }
    throw err;
  }
  const destination = rows[0];
  if (!destination) return notFound();
  deps.logger.info("outbound_destination_updated", {
    tenant_id: tenantId,
    destination_id: destination.id,
    enabled: destination.enabled,
  });
  return { status: 200, body: { destination } };
}

async function deleteDestination(
  sql: SqlClient,
  tenantId: string,
  id: string,
  deps: TenantWebhooksDeps,
): Promise<TenantWebhooksResult> {
  // trg_outbound_destinations_drop_secret deletes the Vault secret; the
  // destination's deliveries cascade.
  const rows = await sql<{ id: string }>`
    delete from public.outbound_destinations
    where id = ${id} and tenant_id = ${tenantId}
    returning id
  `;
  if (rows.length === 0) return notFound();
  deps.logger.info("outbound_destination_deleted", { tenant_id: tenantId, destination_id: id });
  return { status: 200, body: { deleted: true } };
}

async function rotateSecret(
  sql: SqlClient,
  tenantId: string,
  id: string,
  deps: TenantWebhooksDeps,
): Promise<TenantWebhooksResult> {
  const secret = (deps.generateSecret ?? generateSigningSecret)();
  const rotated = await sql<{ rotated: boolean }>`
    with d as (
      update public.outbound_destinations
      set updated_at = now()
      where id = ${id} and tenant_id = ${tenantId}
      returning signing_secret_id
    )
    select public.fn_outbound_secret_rotate(d.signing_secret_id, ${secret}) as rotated from d
  `;
  const row = rotated[0];
  if (!row) return notFound();
  if (!row.rotated) {
    // The Vault row is gone (restored backup, manual cleanup): mint a new one.
    deps.logger.warn("outbound_destination_secret_recreated", {
      tenant_id: tenantId,
      destination_id: id,
    });
    const repointed = await sql<{ id: string }>`
      update public.outbound_destinations
      set signing_secret_id = public.fn_outbound_secret_create(${secret})
      where id = ${id} and tenant_id = ${tenantId}
      returning id
    `;
    if (repointed.length === 0) return notFound();
  }
  deps.logger.info("outbound_destination_secret_rotated", {
    tenant_id: tenantId,
    destination_id: id,
  });
  return { status: 200, body: { signing_secret: secret } };
}

async function sendTest(
  sql: SqlClient,
  tenantId: string,
  id: string,
  deps: TenantWebhooksDeps,
): Promise<TenantWebhooksResult> {
  // The delivery starts parked 5 minutes out so the worker never races this
  // request for it; it is leased right below and sent in-request.
  const inserted = await sql<{ id: string }>`
    with ev as (
      insert into public.outbound_events (tenant_id, event_type, entity_type)
      select d.tenant_id, 'test.ping', 'test'
      from public.outbound_destinations d
      where d.id = ${id} and d.tenant_id = ${tenantId}
      returning id, tenant_id
    )
    insert into public.outbound_deliveries (tenant_id, destination_id, event_id, next_attempt_at)
    select ev.tenant_id, ${id}, ev.id, now() + interval '5 minutes' from ev
    returning id
  `;
  const deliveryId = inserted[0]?.id;
  if (!deliveryId) return notFound();

  const claimed = await claimDeliveryById(sql, tenantId, deliveryId);
  if (!claimed) {
    return {
      status: 200,
      body: {
        ok: false,
        status_code: null,
        error: "Could not start the test",
        delivery_id: deliveryId,
      },
    };
  }
  const result = await processClaimedDelivery(sql, claimed, deps.delivery);
  const statusCode =
    result.status === "delivered" || result.status === "failed" || result.status === "retrying"
      ? result.statusCode
      : null;
  const error =
    result.status === "delivered"
      ? null
      : result.status === "cancelled"
        ? "The test could not be sent"
        : result.error;
  deps.logger.info("outbound_destination_test_sent", {
    tenant_id: tenantId,
    destination_id: id,
    result: result.status,
    status_code: statusCode,
  });
  return {
    status: 200,
    body: {
      ok: result.status === "delivered",
      status_code: statusCode,
      error,
      delivery_id: deliveryId,
    },
  };
}

async function retryDelivery(
  sql: SqlClient,
  tenantId: string,
  deliveryId: string,
  deps: TenantWebhooksDeps,
): Promise<TenantWebhooksResult> {
  const found = await sql<{ status: string; destination_enabled: boolean }>`
    select od.status, d.enabled as destination_enabled
    from public.outbound_deliveries od
    join public.outbound_destinations d on d.id = od.destination_id and d.tenant_id = od.tenant_id
    where od.id = ${deliveryId} and od.tenant_id = ${tenantId}
  `;
  const current = found[0];
  if (!current) return notFound();
  if (current.status !== "failed" && current.status !== "retrying") {
    return { status: 409, body: { error: "not_retryable", status: current.status } };
  }
  if (!current.destination_enabled) {
    return { status: 409, body: { error: "destination_disabled" } };
  }
  const rows = await sql<{ id: string }>`
    update public.outbound_deliveries
    set status = 'retrying', next_attempt_at = now(), locked_until = null
    where id = ${deliveryId} and tenant_id = ${tenantId} and status in ('failed', 'retrying')
    returning id
  `;
  if (rows.length === 0) return { status: 409, body: { error: "not_retryable" } };
  deps.logger.info("outbound_delivery_retry_requested", {
    tenant_id: tenantId,
    delivery_id: deliveryId,
  });
  return { status: 200, body: { delivery_id: deliveryId, status: "retrying" } };
}

export async function handleTenantWebhooks(
  sql: SqlClient,
  tenantId: string,
  req: TenantWebhooksRequest,
  deps: TenantWebhooksDeps,
): Promise<TenantWebhooksResult> {
  switch (req.action) {
    case "create":
      return createDestination(sql, tenantId, req, deps);
    case "update":
      return updateDestination(sql, tenantId, req, deps);
    case "delete":
      return deleteDestination(sql, tenantId, req.id, deps);
    case "rotate_secret":
      return rotateSecret(sql, tenantId, req.id, deps);
    case "send_test":
      return sendTest(sql, tenantId, req.id, deps);
    case "retry":
      return retryDelivery(sql, tenantId, req.delivery_id, deps);
  }
}
