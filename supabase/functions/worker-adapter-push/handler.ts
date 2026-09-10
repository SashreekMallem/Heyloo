import { decryptSecret, encryptSecret } from "../_shared/crypto.ts";
import { createAirtableRecord } from "../_shared/providers/airtable.ts";
import {
  createEzyVetAppointment,
  createEzyVetContact,
  findEzyVetContactByPhone,
  listEzyVetAppointmentChanges,
  refreshEzyVetToken,
  shouldRefreshEzyVetAuth,
} from "../_shared/providers/ezyvet.ts";
import {
  freeBusyQuery as googleFreeBusyQuery,
  getCalendarEvent as googleGetCalendarEvent,
  insertCalendarEvent as googleInsertCalendarEvent,
  listCalendarEvents as googleListCalendarEvents,
  refreshGoogleToken,
  toGoogleEventId,
} from "../_shared/providers/google-calendar.ts";
import {
  createShopmonkeyAppointment,
  createShopmonkeyCustomer,
  findShopmonkeyCustomerByPhone,
  listShopmonkeyAppointmentChanges,
} from "../_shared/providers/shopmonkey.ts";
import {
  searchSquareCatalog as _searchSquareCatalog,
  createSquareBooking,
  createSquareOrder,
  refreshSquareToken,
} from "../_shared/providers/square.ts";
import type { AdapterPushQueueMsg } from "../_shared/queue.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `adapter_push_queue` worker (BACKEND_SPEC §9/§7.6) — real per-adapter
 * pushers (T7; T3 left `ADAPTER_PUSHERS` empty, every push dead-lettering).
 *
 * Every entry below follows the same shape:
 *   1. load the tenant's `adapter_connections` row (bail — never push with
 *      no/disconnected connection);
 *   2. proactively refresh auth where the provider's own TTL calls for it
 *      (ezyVet's 12h token; Square/Google's OAuth access token once past
 *      its `expires_at`) — BACKEND_SPEC §7.6's "refreshAuth should run
 *      proactively ... to avoid a live booking-write racing an expired
 *      token";
 *   3. load the `bookings`/`orders` row (+ joined customer/offering/
 *      resource) from Heyloo's own tables — never trust the queue message
 *      for anything but ids, the DB row is authoritative;
 *   4. map to the provider's push shape and call it;
 *   5. on success, upsert `adapter_sync_state` (idempotent push
 *      bookkeeping); on an auth failure, mark the connection
 *      `disconnected` (BACKEND_SPEC §7.6's `auth_revoked` handling,
 *      symmetric with the webhook path in `webhooks-pos/handler.ts`).
 *
 * Offering/resource -> provider id mapping: T1's schema has no per-adapter
 * external-id column on `offerings`/`resources` (CLAUDE.md Rule 2 keeps
 * those tables adapter-agnostic — same reasoning BACKEND_SPEC §10.3 gives
 * for why Airtable's mapping lives in its own side table, not a new
 * `bookings` column). Lacking a dedicated adapter-catalog-mapping table
 * (out of this task's one-migration allowance), this build reads/writes
 * the mapping through the EXISTING generic `metadata` jsonb column on both
 * tables, namespaced as `metadata.adapter_external_id.<provider>` — e.g.
 * `offerings.metadata = {"adapter_external_id": {"square": "svc_123"}}`.
 * Documented here and in docs/BUILD_NOTES.md as a pragmatic reuse of an
 * existing generic column, not a schema decision T7 is authorized to make
 * unilaterally — a dedicated mapping table (populated by `syncCatalog`) is
 * flagged as the more robust long-term design.
 */
export type AdapterPusher = (
  sql: SqlClient,
  msg: AdapterPushQueueMsg,
  logger: Logger,
  deps: AdapterPushDeps,
) => Promise<boolean>;

export interface AdapterPushDeps {
  fetchImpl: typeof fetch;
  square: { clientId: string; clientSecret: string };
  ezyvet: { clientId: string; clientSecret: string; partnerId: string };
  googleCalendar: { clientId: string; clientSecret: string };
  // DB-H2: AES-256-GCM key `adapter_connections.access_token`/
  // `refresh_token` are decrypted with on read / re-encrypted with on
  // refresh — see `_shared/crypto.ts`.
  tokenEncryptionKey: string;
}

interface ConnectionRow {
  id: string;
  status: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  provider_account_id: string | null;
  metadata: Record<string, unknown>;
}

async function loadConnection(
  sql: SqlClient,
  tenantId: string,
  provider: string,
  tokenEncryptionKey: string,
): Promise<ConnectionRow | null> {
  const rows = await sql<ConnectionRow>`
    select id, status, access_token, refresh_token, expires_at, provider_account_id, metadata
    from public.adapter_connections
    where tenant_id = ${tenantId} and provider = ${provider}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  // DB-H2: decrypt on read — `decryptSecret` tolerates a legacy plaintext
  // row (no "v1:" prefix) so this works against data written before the
  // encryption fix, too.
  return {
    ...row,
    access_token: row.access_token
      ? await decryptSecret(row.access_token, tokenEncryptionKey)
      : null,
    refresh_token: row.refresh_token
      ? await decryptSecret(row.refresh_token, tokenEncryptionKey)
      : null,
  };
}

async function markConnectionDisconnected(
  sql: SqlClient,
  connectionId: string,
  reason: string,
): Promise<void> {
  await sql`
    update public.adapter_connections
    set status = 'disconnected', disconnected_at = now(), last_error = ${reason}
    where id = ${connectionId}
  `;
}

async function markConnectionRefreshed(
  sql: SqlClient,
  connectionId: string,
  patch: { accessToken: string; expiresAt?: string | undefined },
  tokenEncryptionKey: string,
): Promise<void> {
  const encryptedAccessToken = await encryptSecret(patch.accessToken, tokenEncryptionKey);
  await sql`
    update public.adapter_connections
    set access_token = ${encryptedAccessToken},
        expires_at = ${patch.expiresAt ?? null},
        last_refreshed_at = now(),
        last_error = null
    where id = ${connectionId}
  `;
}

async function recordSyncSuccess(
  sql: SqlClient,
  params: {
    tenantId: string;
    provider: string;
    entityType: "booking" | "order";
    entityId: string;
    externalId: string;
  },
): Promise<void> {
  await sql`
    insert into public.adapter_sync_state (tenant_id, provider, entity_type, entity_id, external_id, last_synced_at)
    values (${params.tenantId}, ${params.provider}, ${params.entityType}, ${params.entityId}, ${params.externalId}, now())
    on conflict (tenant_id, provider, entity_type, entity_id)
    do update set external_id = excluded.external_id, last_synced_at = now(), sync_conflict = false
  `;
}

interface BookingRow {
  id: string;
  start_at: string;
  end_at: string;
  notes: string | null;
  party_size: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  offering_metadata: Record<string, unknown> | null;
  resource_metadata: Record<string, unknown> | null;
}

async function loadBookingForPush(
  sql: SqlClient,
  tenantId: string,
  bookingId: string,
): Promise<BookingRow | null> {
  const rows = await sql<BookingRow>`
    select
      b.id, b.start_at, b.end_at, b.notes, b.party_size,
      c.name as customer_name, c.phone_e164 as customer_phone, c.email as customer_email,
      o.metadata as offering_metadata,
      r.metadata as resource_metadata
    from public.bookings b
    left join public.customers c on c.id = b.customer_id
    left join public.offerings o on o.id = b.offering_id
    left join public.resources r on r.id = b.resource_id
    where b.id = ${bookingId} and b.tenant_id = ${tenantId}
    limit 1
  `;
  return rows[0] ?? null;
}

interface OrderRow {
  id: string;
  items: { name: string; qty: number; unit_price_cents: number; modifiers?: string[] }[];
  fulfillment_type: "pickup" | "delivery" | "dine_in";
  delivery_address: Record<string, unknown> | null;
  total_cents: number;
  customer_name: string | null;
  customer_phone: string | null;
}

async function loadOrderForPush(
  sql: SqlClient,
  tenantId: string,
  orderId: string,
): Promise<OrderRow | null> {
  const rows = await sql<OrderRow>`
    select
      o.id, o.items, o.fulfillment_type, o.delivery_address, o.total_cents,
      c.name as customer_name, c.phone_e164 as customer_phone
    from public.orders o
    left join public.customers c on c.id = o.customer_id
    where o.id = ${orderId} and o.tenant_id = ${tenantId}
    limit 1
  `;
  return rows[0] ?? null;
}

function adapterExternalId(
  metadata: Record<string, unknown> | null,
  provider: string,
): string | undefined {
  const bag = metadata?.["adapter_external_id"] as Record<string, unknown> | undefined;
  const value = bag?.[provider];
  return typeof value === "string" ? value : undefined;
}

// ---------------------------------------------------------------------------
// Square
// ---------------------------------------------------------------------------

async function pushToSquare(
  sql: SqlClient,
  msg: AdapterPushQueueMsg,
  logger: Logger,
  deps: AdapterPushDeps,
): Promise<boolean> {
  const connection = await loadConnection(sql, msg.tenant_id, "square", deps.tokenEncryptionKey);
  if (connection?.status !== "connected" || !connection.access_token) {
    logger.warn("adapter_push_no_connection", { adapter: "square", tenant_id: msg.tenant_id });
    return false;
  }

  let accessToken = connection.access_token;
  if (
    connection.expires_at &&
    Date.parse(connection.expires_at) - Date.now() <= 0 &&
    connection.refresh_token
  ) {
    const refreshed = await refreshSquareToken(deps.fetchImpl, {
      clientId: deps.square.clientId,
      clientSecret: deps.square.clientSecret,
      refreshToken: connection.refresh_token,
    });
    if (!refreshed.ok) {
      await markConnectionDisconnected(sql, connection.id, "square token refresh failed");
      return false;
    }
    const body = refreshed.body as { access_token: string; expires_at?: string };
    accessToken = body.access_token;
    await markConnectionRefreshed(
      sql,
      connection.id,
      { accessToken, expiresAt: body.expires_at },
      deps.tokenEncryptionKey,
    );
  }

  const locationId = connection.metadata["locationId"];
  if (typeof locationId !== "string") {
    logger.warn("adapter_push_missing_metadata", { adapter: "square", field: "locationId" });
    return false;
  }

  if (msg.entity_type === "booking") {
    const booking = await loadBookingForPush(sql, msg.tenant_id, msg.entity_id);
    if (!booking) return false;
    const teamMemberId =
      adapterExternalId(booking.resource_metadata, "square") ??
      (connection.metadata["defaultTeamMemberId"] as string | undefined);
    const serviceVariationId = adapterExternalId(booking.offering_metadata, "square");
    if (!teamMemberId || !serviceVariationId) {
      logger.warn("adapter_push_missing_catalog_mapping", {
        adapter: "square",
        entity_id: msg.entity_id,
      });
      return false;
    }
    const result = await createSquareBooking(deps.fetchImpl, accessToken, {
      idempotencyKey: msg.idempotency_key,
      locationId,
      startAt: booking.start_at,
      teamMemberId,
      serviceVariationId,
      customerNote:
        `${booking.customer_name ?? "Phone caller"} ${booking.customer_phone ?? ""}`.trim(),
    });
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        await markConnectionDisconnected(sql, connection.id, "square 401 on booking push");
      }
      return false;
    }
    const external = (result.body as { booking: { id: string } }).booking.id;
    await recordSyncSuccess(sql, {
      tenantId: msg.tenant_id,
      provider: "square",
      entityType: "booking",
      entityId: msg.entity_id,
      externalId: external,
    });
    return true;
  }

  const order = await loadOrderForPush(sql, msg.tenant_id, msg.entity_id);
  if (!order) return false;
  const result = await createSquareOrder(deps.fetchImpl, accessToken, {
    idempotencyKey: msg.idempotency_key,
    locationId,
    items: order.items.map((item) => ({
      name: item.name,
      qty: item.qty,
      unitPriceCents: item.unit_price_cents,
      modifiers: item.modifiers,
    })),
    fulfillmentType: order.fulfillment_type,
    customerName: order.customer_name ?? undefined,
    customerPhoneE164: order.customer_phone ?? undefined,
    deliveryAddress: order.delivery_address ?? undefined,
  });
  if (!result.ok) {
    if (result.status === 401 || result.status === 403) {
      await markConnectionDisconnected(sql, connection.id, "square 401 on order push");
    }
    return false;
  }
  const external = (result.body as { order: { id: string } }).order.id;
  await recordSyncSuccess(sql, {
    tenantId: msg.tenant_id,
    provider: "square",
    entityType: "order",
    entityId: msg.entity_id,
    externalId: external,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Shopmonkey (booking push only — no order/restaurant use case)
// ---------------------------------------------------------------------------

async function pushToShopmonkey(
  sql: SqlClient,
  msg: AdapterPushQueueMsg,
  logger: Logger,
  deps: AdapterPushDeps,
): Promise<boolean> {
  if (msg.entity_type !== "booking") {
    logger.warn("adapter_push_unsupported_entity_type", {
      adapter: "shopmonkey",
      entity_type: msg.entity_type,
    });
    return false;
  }
  const connection = await loadConnection(
    sql,
    msg.tenant_id,
    "shopmonkey",
    deps.tokenEncryptionKey,
  );
  if (connection?.status !== "connected" || !connection.access_token) {
    logger.warn("adapter_push_no_connection", { adapter: "shopmonkey", tenant_id: msg.tenant_id });
    return false;
  }
  const apiKey = connection.access_token;

  const booking = await loadBookingForPush(sql, msg.tenant_id, msg.entity_id);
  if (!booking) return false;

  const searchResult = await findShopmonkeyCustomerByPhone(
    deps.fetchImpl,
    apiKey,
    booking.customer_phone ?? "",
  );
  if (!searchResult.ok) {
    if (searchResult.status === 401)
      await markConnectionDisconnected(sql, connection.id, "shopmonkey 401");
    return false;
  }
  const existingCustomer = (searchResult.body as { data?: { id: string }[] })?.data?.[0];
  let customerId = existingCustomer?.id;
  if (!customerId) {
    const [firstName, ...rest] = (booking.customer_name ?? "Phone caller").trim().split(/\s+/);
    const createResult = await createShopmonkeyCustomer(deps.fetchImpl, apiKey, {
      name: booking.customer_name ?? "Phone caller",
      phoneE164: booking.customer_phone ?? "",
      email: booking.customer_email ?? undefined,
    });
    if (!createResult.ok) return false;
    customerId = (createResult.body as { id: string }).id;
    void firstName;
    void rest;
  }

  const result = await createShopmonkeyAppointment(deps.fetchImpl, apiKey, {
    customerId,
    laborRateId: adapterExternalId(booking.offering_metadata, "shopmonkey"),
    bayId: adapterExternalId(booking.resource_metadata, "shopmonkey"),
    startAt: booking.start_at,
    endAt: booking.end_at,
    notes: booking.notes ?? undefined,
    idempotencyKey: msg.idempotency_key,
  });
  if (!result.ok) {
    if (result.status === 401)
      await markConnectionDisconnected(sql, connection.id, "shopmonkey 401 on push");
    return false;
  }
  const external = (result.body as { id: string }).id;
  await recordSyncSuccess(sql, {
    tenantId: msg.tenant_id,
    provider: "shopmonkey",
    entityType: "booking",
    entityId: msg.entity_id,
    externalId: external,
  });
  return true;
}

// ---------------------------------------------------------------------------
// ezyVet (booking push only)
// ---------------------------------------------------------------------------

async function pushToEzyVet(
  sql: SqlClient,
  msg: AdapterPushQueueMsg,
  logger: Logger,
  deps: AdapterPushDeps,
): Promise<boolean> {
  if (msg.entity_type !== "booking") {
    logger.warn("adapter_push_unsupported_entity_type", {
      adapter: "ezyvet",
      entity_type: msg.entity_type,
    });
    return false;
  }
  const connection = await loadConnection(sql, msg.tenant_id, "ezyvet", deps.tokenEncryptionKey);
  if (connection?.status !== "connected" || !connection.access_token) {
    logger.warn("adapter_push_no_connection", { adapter: "ezyvet", tenant_id: msg.tenant_id });
    return false;
  }
  const baseUrl = connection.metadata["baseUrl"];
  if (typeof baseUrl !== "string") {
    logger.warn("adapter_push_missing_metadata", { adapter: "ezyvet", field: "baseUrl" });
    return false;
  }

  let accessToken = connection.access_token;
  if (shouldRefreshEzyVetAuth(connection.expires_at)) {
    const refreshed = await refreshEzyVetToken(deps.fetchImpl, baseUrl, deps.ezyvet);
    if (!refreshed.ok) {
      await markConnectionDisconnected(
        sql,
        connection.id,
        "ezyvet client-credentials refresh failed",
      );
      return false;
    }
    const body = refreshed.body as { access_token: string; expires_in?: number };
    accessToken = body.access_token;
    const expiresAt = body.expires_in
      ? new Date(Date.now() + body.expires_in * 1000).toISOString()
      : undefined;
    await markConnectionRefreshed(
      sql,
      connection.id,
      { accessToken, expiresAt },
      deps.tokenEncryptionKey,
    );
  }

  const booking = await loadBookingForPush(sql, msg.tenant_id, msg.entity_id);
  if (!booking) return false;

  const searchResult = await findEzyVetContactByPhone(
    deps.fetchImpl,
    baseUrl,
    accessToken,
    booking.customer_phone ?? "",
  );
  if (!searchResult.ok) {
    if (searchResult.status === 401)
      await markConnectionDisconnected(sql, connection.id, "ezyvet 401");
    return false;
  }
  const existingContact = (searchResult.body as { items?: { id: string | number }[] })?.items?.[0];
  let contactId = existingContact ? String(existingContact.id) : undefined;
  if (!contactId) {
    const [firstName, ...rest] = (booking.customer_name ?? "Phone caller").trim().split(/\s+/);
    const createResult = await createEzyVetContact(deps.fetchImpl, baseUrl, accessToken, {
      firstName: firstName || "Phone",
      lastName: rest.join(" ") || "caller",
      mobile: booking.customer_phone ?? "",
      email: booking.customer_email ?? undefined,
    });
    if (!createResult.ok) return false;
    contactId = String((createResult.body as { id: string | number }).id);
  }

  const result = await createEzyVetAppointment(deps.fetchImpl, baseUrl, accessToken, {
    contactId,
    physicalResourceId: adapterExternalId(booking.resource_metadata, "ezyvet"),
    appointmentTypeId: adapterExternalId(booking.offering_metadata, "ezyvet"),
    startAt: booking.start_at,
    endAt: booking.end_at,
    notes: booking.notes ?? undefined,
    idempotencyKey: msg.idempotency_key,
  });
  if (!result.ok) {
    if (result.status === 401)
      await markConnectionDisconnected(sql, connection.id, "ezyvet 401 on push");
    return false;
  }
  const external = String((result.body as { id: string | number }).id);
  await recordSyncSuccess(sql, {
    tenantId: msg.tenant_id,
    provider: "ezyvet",
    entityType: "booking",
    entityId: msg.entity_id,
    externalId: external,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Google Calendar (booking push only)
// ---------------------------------------------------------------------------

async function pushToGoogleCalendar(
  sql: SqlClient,
  msg: AdapterPushQueueMsg,
  logger: Logger,
  deps: AdapterPushDeps,
): Promise<boolean> {
  if (msg.entity_type !== "booking") {
    logger.warn("adapter_push_unsupported_entity_type", {
      adapter: "google_calendar",
      entity_type: msg.entity_type,
    });
    return false;
  }
  const connection = await loadConnection(
    sql,
    msg.tenant_id,
    "google_calendar",
    deps.tokenEncryptionKey,
  );
  if (connection?.status !== "connected" || !connection.access_token || !connection.refresh_token) {
    logger.warn("adapter_push_no_connection", {
      adapter: "google_calendar",
      tenant_id: msg.tenant_id,
    });
    return false;
  }

  let accessToken = connection.access_token;
  if (connection.expires_at && Date.parse(connection.expires_at) - Date.now() <= 0) {
    const refreshed = await refreshGoogleToken(deps.fetchImpl, {
      clientId: deps.googleCalendar.clientId,
      clientSecret: deps.googleCalendar.clientSecret,
      refreshToken: connection.refresh_token,
    });
    if (!refreshed.ok) {
      await markConnectionDisconnected(
        sql,
        connection.id,
        "google_calendar refresh_token invalid/revoked",
      );
      return false;
    }
    const body = refreshed.body as { access_token: string; expires_in: number };
    accessToken = body.access_token;
    await markConnectionRefreshed(
      sql,
      connection.id,
      {
        accessToken,
        expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
      },
      deps.tokenEncryptionKey,
    );
  }

  const calendarId = (connection.metadata["calendarId"] as string | undefined) ?? "primary";
  const booking = await loadBookingForPush(sql, msg.tenant_id, msg.entity_id);
  if (!booking) return false;

  const insertResult = await googleInsertCalendarEvent(deps.fetchImpl, accessToken, {
    calendarId,
    idempotencyKey: msg.idempotency_key,
    summary: `${booking.customer_name ?? "Phone caller"} — booking`,
    description: `Phone: ${booking.customer_phone ?? "n/a"}${booking.notes ? `\nNotes: ${booking.notes}` : ""}`,
    startAt: booking.start_at,
    endAt: booking.end_at,
  });

  let externalId: string;
  if (insertResult.ok) {
    externalId = (insertResult.body as { id: string }).id;
  } else if (insertResult.status === 409) {
    // Deterministic event id already exists — our own idempotency
    // guarantee, not a real conflict (matches `packages/adapters/
    // google-calendar/src/booking.ts`'s dedup handling).
    const existing = await googleGetCalendarEvent(
      deps.fetchImpl,
      accessToken,
      calendarId,
      toGoogleEventId(msg.idempotency_key),
    );
    if (!existing.ok) return false;
    externalId = (existing.body as { id: string }).id;
  } else {
    if (insertResult.status === 401 || insertResult.status === 403) {
      await markConnectionDisconnected(sql, connection.id, "google_calendar 401/403 on push");
    }
    return false;
  }

  await recordSyncSuccess(sql, {
    tenantId: msg.tenant_id,
    provider: "google_calendar",
    entityType: "booking",
    entityId: msg.entity_id,
    externalId,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Airtable (booking + order push — a generic no-code base, unlike the
// booking-only Shopmonkey/ezyVet adapters). docs/audit/FIX_REQUESTS.md
// (cluster C, "request the worker from cluster E").
// ---------------------------------------------------------------------------

function airtableFieldsForBooking(booking: BookingRow): Record<string, unknown> {
  return {
    "Customer Name": booking.customer_name ?? "Phone caller",
    Phone: booking.customer_phone ?? "",
    Start: booking.start_at,
    End: booking.end_at,
    Notes: booking.notes ?? "",
  };
}

function airtableFieldsForOrder(order: OrderRow): Record<string, unknown> {
  return {
    "Customer Name": order.customer_name ?? "Phone caller",
    Phone: order.customer_phone ?? "",
    Items: order.items.map((item) => `${item.qty}x ${item.name}`).join(", "),
    "Total ($)": order.total_cents / 100,
    Fulfillment: order.fulfillment_type,
  };
}

async function pushToAirtable(
  sql: SqlClient,
  msg: AdapterPushQueueMsg,
  logger: Logger,
  deps: AdapterPushDeps,
): Promise<boolean> {
  const connection = await loadConnection(sql, msg.tenant_id, "airtable", deps.tokenEncryptionKey);
  if (connection?.status !== "connected" || !connection.access_token) {
    logger.warn("adapter_push_no_connection", { adapter: "airtable", tenant_id: msg.tenant_id });
    return false;
  }
  const baseId = connection.metadata["baseId"];
  const tableIdOrName = connection.metadata["tableIdOrName"];
  if (typeof baseId !== "string" || typeof tableIdOrName !== "string") {
    logger.warn("adapter_push_missing_metadata", {
      adapter: "airtable",
      field: "baseId/tableIdOrName",
    });
    return false;
  }

  let fields: Record<string, unknown> | undefined;
  if (msg.entity_type === "booking") {
    const booking = await loadBookingForPush(sql, msg.tenant_id, msg.entity_id);
    if (!booking) return false;
    fields = airtableFieldsForBooking(booking);
  } else {
    const order = await loadOrderForPush(sql, msg.tenant_id, msg.entity_id);
    if (!order) return false;
    fields = airtableFieldsForOrder(order);
  }

  const result = await createAirtableRecord(deps.fetchImpl, connection.access_token, {
    baseId,
    tableIdOrName,
    fields,
  });
  if (!result.ok) {
    if (result.status === 401 || result.status === 403) {
      await markConnectionDisconnected(sql, connection.id, "airtable 401/403 on push");
    }
    return false;
  }
  const external = (result.body as { id: string }).id;
  await recordSyncSuccess(sql, {
    tenantId: msg.tenant_id,
    provider: "airtable",
    entityType: msg.entity_type,
    entityId: msg.entity_id,
    externalId: external,
  });
  return true;
}

export const ADAPTER_PUSHERS: Record<string, AdapterPusher> = {
  square: pushToSquare,
  shopmonkey: pushToShopmonkey,
  ezyvet: pushToEzyVet,
  airtable: pushToAirtable,
  google_calendar: pushToGoogleCalendar,
};

export async function pushToAdapter(
  sql: SqlClient,
  msg: AdapterPushQueueMsg,
  logger: Logger,
  deps: AdapterPushDeps,
): Promise<boolean> {
  const pusher = ADAPTER_PUSHERS[msg.adapter];
  if (!pusher) {
    logger.warn("adapter_push_not_implemented", {
      adapter: msg.adapter,
      entity_type: msg.entity_type,
    });
    return false;
  }
  return pusher(sql, msg, logger, deps);
}

// ---------------------------------------------------------------------------
// Two-way sync pull-back (G11) — poll-based fallback for ezyVet/Shopmonkey
// (unconfirmed webhook coverage) and Google Calendar (notifications carry
// no diffable content). NOT yet wired to a pg_cron schedule — this task's
// exclusive paths cover `worker-adapter-push/` + `webhooks-pos/` +
// `_shared/providers/*`, not a new `job-*` function/cron entry (T3/T4's
// established territory); exported here, contract-tested, and ready for
// that follow-up wiring (flagged in docs/BUILD_NOTES.md's T7 entry).
// ---------------------------------------------------------------------------

export interface PollResult {
  pulled: number;
  conflictsFlagged: number;
}

async function flagConflictIfMapped(
  sql: SqlClient,
  tenantId: string,
  provider: string,
  externalId: string,
): Promise<boolean> {
  const rows = await sql<{ entity_type: string; entity_id: string; sync_conflict: boolean }>`
    select entity_type, entity_id, sync_conflict
    from public.adapter_sync_state
    where tenant_id = ${tenantId} and provider = ${provider} and external_id = ${externalId}
    limit 1
  `;
  const match = rows[0];
  if (!match || match.sync_conflict) return false;
  await sql`
    update public.adapter_sync_state
    set sync_conflict = true
    where tenant_id = ${tenantId} and provider = ${provider}
      and entity_type = ${match.entity_type} and entity_id = ${match.entity_id}
  `;
  return true;
}

export async function pollAdapterChanges(
  sql: SqlClient,
  tenantId: string,
  provider: "ezyvet" | "shopmonkey" | "google_calendar",
  logger: Logger,
  deps: AdapterPushDeps,
): Promise<PollResult> {
  const connection = await loadConnection(sql, tenantId, provider, deps.tokenEncryptionKey);
  if (connection?.status !== "connected" || !connection.access_token) {
    return { pulled: 0, conflictsFlagged: 0 };
  }
  const cursor =
    typeof connection.metadata["pull_cursor"] === "string"
      ? (connection.metadata["pull_cursor"] as string)
      : undefined;
  const now = new Date().toISOString();

  let externalIds: string[] = [];
  if (provider === "ezyvet") {
    const baseUrl = connection.metadata["baseUrl"] as string | undefined;
    if (!baseUrl) return { pulled: 0, conflictsFlagged: 0 };
    const result = await listEzyVetAppointmentChanges(
      deps.fetchImpl,
      baseUrl,
      connection.access_token,
      cursor,
    );
    if (!result.ok) return { pulled: 0, conflictsFlagged: 0 };
    externalIds = ((result.body as { items?: { id: string | number }[] })?.items ?? []).map((i) =>
      String(i.id),
    );
  } else if (provider === "shopmonkey") {
    const result = await listShopmonkeyAppointmentChanges(
      deps.fetchImpl,
      connection.access_token,
      cursor,
    );
    if (!result.ok) return { pulled: 0, conflictsFlagged: 0 };
    externalIds = ((result.body as { data?: { id: string }[] })?.data ?? []).map((i) => i.id);
  } else {
    const calendarId = (connection.metadata["calendarId"] as string | undefined) ?? "primary";
    const result = await googleListCalendarEvents(
      deps.fetchImpl,
      connection.access_token,
      calendarId,
      cursor,
    );
    if (!result.ok) return { pulled: 0, conflictsFlagged: 0 };
    externalIds = ((result.body as { items?: { id: string }[] })?.items ?? []).map((i) => i.id);
  }

  let conflictsFlagged = 0;
  for (const externalId of externalIds) {
    if (await flagConflictIfMapped(sql, tenantId, provider, externalId)) conflictsFlagged += 1;
  }

  await sql`
    update public.adapter_connections
    set metadata = jsonb_set(metadata, '{pull_cursor}', to_jsonb(${now}::text))
    where id = ${connection.id}
  `;

  logger.info("adapter_poll_completed", {
    provider,
    tenant_id: tenantId,
    pulled: externalIds.length,
    conflictsFlagged,
  });
  return { pulled: externalIds.length, conflictsFlagged };
}

// Exported so a future admin cockpit "sync catalog now" action (or the
// provisioning saga's first-connect step) can reuse this without a second
// implementation — not wired to any caller in this task's scope.
export { _searchSquareCatalog as searchSquareCatalog, googleFreeBusyQuery };
