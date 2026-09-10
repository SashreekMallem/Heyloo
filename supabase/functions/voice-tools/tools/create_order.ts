import type { z } from "zod";
import { enqueueAdapterPush } from "../../_shared/adapter-push.ts";
import { isWithinRadius } from "../../_shared/geo.ts";
import { orderIdempotencyKey } from "../../_shared/idempotency.ts";
import { normalizeE164 } from "../../_shared/phone.ts";
import type { GeocodeFetch } from "../../_shared/providers/geocode.ts";
import { geocodeAddress } from "../../_shared/providers/geocode.ts";
import { enqueue, QUEUE_NAMES } from "../../_shared/queue.ts";
import type { CreateOrderArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { Logger, SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";

type Args = z.infer<typeof CreateOrderArgsSchema>;

interface OfferingRow {
  id: string;
  name: string;
  price_cents: number | null;
}

export type CreateOrderResult =
  | { order_id: string; confirmed: true; total_cents: number; delivery_fee_cents?: number }
  | {
      confirmed: false;
      reason: "item_not_found" | "out_of_delivery_radius" | "below_minimum_order" | "invalid_phone";
      item_name?: string;
      pickup_offered?: boolean;
    };

const UNIQUE_VIOLATION = "23505";

function isPgError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === code;
}

/**
 * MASTER_SPEC §3.0 `create_order` tool (mirrors `create_booking`'s
 * idempotent-insert shape). Items are validated against `offerings` — a
 * tool-backed catalog, never model-invented pricing. Delivery orders
 * require a delivery-radius check: the caller's geocode comes from their
 * saved `customer_addresses.geocode` (T1's `20260907130400_customers.sql` —
 * a native Postgres `point`, precomputed at address-save time), so the
 * check runs for a REPEAT delivery customer with a saved default address;
 * a first-time caller has no saved address yet (this tool never geocodes
 * a freshly-spoken address live — that's a separate settings-time/address-
 * save-time concern, MASTER_SPEC §3.1) and the check is skipped with a
 * logged warning rather than blocking the order or fabricating a decision.
 * The tenant's own geocode + radius/minimum-order policy is read from
 * `agent_configs.dynamic_variable_overrides` (`tenant_geocode`,
 * `delivery_radius_m`, `min_order_cents` — the latter two confirmed
 * against T1's `20260907130300_agent_templates.sql` comment; `tenant_geocode`
 * itself is this file's own reasonable placement, VERIFY.md, since neither
 * spec pins a column for it and no dedicated tenant-geocode column exists
 * in T1's schema).
 *
 * restaurant.md Finding B4 fix: a confirmed delivery order best-effort
 * upserts the spoken `delivery_address` onto `customer_addresses`
 * (geocoded via `deps.geocode`, VERIFY-12) so a REPEAT caller's next order
 * actually has a saved geocode for the radius check above to use, and so
 * `lookup_customer` has a real saved address to surface (restaurant.ts's
 * "confirm it back instead of asking from scratch" instruction). Entirely
 * optional/non-blocking: when `deps.geocode` isn't wired (no
 * `GEOCODE_API_KEY`) or the geocode fails, the order still completes
 * exactly as before — this is a save-for-next-time enhancement, never a
 * condition of the current order succeeding.
 */
export async function createOrder(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
  logger: Logger,
  deps?: { geocode?: { fetchImpl: GeocodeFetch; apiKey: string } },
): Promise<CreateOrderResult> {
  const phone = normalizeE164(args.customer.phone);
  if (!phone) return { confirmed: false, reason: "invalid_phone" };

  const idempotencyKey = orderIdempotencyKey(ctx.retellCallId, args.items);

  const existing = await sql<{
    id: string;
    total_cents: number;
    delivery_fee_cents: number | null;
  }>`
    select id, total_cents, delivery_fee_cents from public.orders
    where tenant_id = ${ctx.tenantId} and idempotency_key = ${idempotencyKey}
    limit 1
  `;
  const prior = existing[0];
  if (prior) {
    return {
      order_id: prior.id,
      confirmed: true,
      total_cents: prior.total_cents,
      ...(prior.delivery_fee_cents ? { delivery_fee_cents: prior.delivery_fee_cents } : {}),
    };
  }

  const offeringIds = args.items.map((i) => i.offering_id).filter((id): id is string => !!id);
  const offeringRows = offeringIds.length
    ? await sql<OfferingRow>`
        select id, name, price_cents from public.offerings
        where tenant_id = ${ctx.tenantId} and id = any(${offeringIds}) and active
      `
    : [];
  const offeringsById = new Map(offeringRows.map((o) => [o.id, o]));

  let subtotalCents = 0;
  const priced: {
    offering_id: string | null;
    name: string;
    qty: number;
    unit_price_cents: number;
    modifiers: string[];
  }[] = [];
  for (const item of args.items) {
    const offering = item.offering_id ? offeringsById.get(item.offering_id) : undefined;
    if (!item.offering_id || !offering || offering.price_cents === null) {
      return { confirmed: false, reason: "item_not_found", item_name: item.name };
    }
    subtotalCents += offering.price_cents * item.qty;
    priced.push({
      offering_id: offering.id,
      name: offering.name,
      qty: item.qty,
      unit_price_cents: offering.price_cents,
      modifiers: item.modifiers ?? [],
    });
  }

  const configRows = await sql<{ dynamic_variable_overrides: Record<string, unknown> }>`
    select dynamic_variable_overrides from public.agent_configs where tenant_id = ${ctx.tenantId}
  `;
  const overrides = configRows[0]?.dynamic_variable_overrides ?? {};

  if (args.fulfillment_type === "delivery") {
    const minOrderCents =
      typeof overrides["min_order_cents"] === "number" ? overrides["min_order_cents"] : 0;
    if (subtotalCents < minOrderCents) {
      return { confirmed: false, reason: "below_minimum_order", pickup_offered: true };
    }

    const tenantGeocode = overrides["tenant_geocode"] as { lat?: number; lng?: number } | undefined;
    const radiusMeters =
      typeof overrides["delivery_radius_m"] === "number"
        ? overrides["delivery_radius_m"]
        : undefined;

    if (
      tenantGeocode?.lat !== undefined &&
      tenantGeocode.lng !== undefined &&
      radiusMeters !== undefined
    ) {
      // `customer_addresses.geocode` is a native `point` — postgres.js
      // returns it as `{x, y}` (x=lng, y=lat) per the Postgres point wire
      // format.
      const addressRows = await sql<{ geocode: { x: number; y: number } | null }>`
        select ca.geocode
        from public.customer_addresses ca
        join public.customers c on c.id = ca.customer_id
        where c.tenant_id = ${ctx.tenantId} and c.phone_e164 = ${phone} and ca.geocode is not null
        order by ca.is_default desc, ca.created_at desc
        limit 1
      `;
      const callerGeocode = addressRows[0]?.geocode;

      if (callerGeocode) {
        const within = isWithinRadius(
          { lat: tenantGeocode.lat, lng: tenantGeocode.lng },
          { lat: callerGeocode.y, lng: callerGeocode.x },
          radiusMeters,
        );
        if (!within) {
          return { confirmed: false, reason: "out_of_delivery_radius", pickup_offered: true };
        }
      } else {
        logger.warn("create_order_radius_check_skipped_no_caller_geocode", {
          call_id: ctx.retellCallId,
          tenant_id: ctx.tenantId,
        });
      }
    }
  }

  const taxRateBps = typeof overrides["tax_rate_bps"] === "number" ? overrides["tax_rate_bps"] : 0;
  const taxCents = Math.round((subtotalCents * taxRateBps) / 10_000);
  // GAP_REGISTER.md §4 Cluster D — delivery-fee enforcement from the
  // tenant's own per-vertical config, read directly from `agent_configs.
  // dynamic_variable_overrides` (mirrors the existing `min_order_cents`/
  // `delivery_radius_m`/`tax_rate_bps` reads above) — 0 for pickup/dine_in
  // and for a tenant with no configured fee.
  const deliveryFeeCents =
    args.fulfillment_type === "delivery" && typeof overrides["delivery_fee_cents"] === "number"
      ? overrides["delivery_fee_cents"]
      : 0;
  const totalCents = subtotalCents + taxCents + deliveryFeeCents;

  const customerRows = await sql<{ id: string }>`
    insert into public.customers (tenant_id, phone_e164, name)
    values (${ctx.tenantId}, ${phone}, ${args.customer.name ?? null})
    on conflict (tenant_id, phone_e164)
    do update set name = coalesce(excluded.name, public.customers.name), last_seen_at = now()
    returning id
  `;
  const customerId = customerRows[0]?.id ?? null;

  const consentPayload = args.consent
    ? {
        sms: args.consent.sms ?? false,
        call: args.consent.call ?? false,
        captured_at: new Date().toISOString(),
        call_id: ctx.retellCallId,
      }
    : null;

  let order: { id: string } | undefined;
  try {
    const inserted = await sql<{ id: string }>`
      insert into public.orders (
        tenant_id, customer_id, items, fulfillment_type, delivery_address,
        subtotal_cents, tax_cents, delivery_fee_cents, total_cents, source_call_id, idempotency_key,
        allergies, special_instructions
      ) values (
        ${ctx.tenantId}, ${customerId}, ${JSON.stringify(priced)}::jsonb, ${args.fulfillment_type},
        ${args.delivery_address ? JSON.stringify(args.delivery_address) : null}::jsonb,
        ${subtotalCents}, ${taxCents}, ${deliveryFeeCents}, ${totalCents}, ${ctx.callLogId}, ${idempotencyKey},
        ${args.allergies && args.allergies.length > 0 ? args.allergies : null},
        ${args.special_instructions ?? null}
      )
      returning id
    `;
    order = inserted[0];
  } catch (err) {
    if (!isPgError(err, UNIQUE_VIOLATION)) throw err;
    // Concurrent retry raced us on `orders_idempotency_unique` — the other
    // call won, return its row rather than erroring or duplicating.
    const raceWinner = await sql<{
      id: string;
      total_cents: number;
      delivery_fee_cents: number | null;
    }>`
      select id, total_cents, delivery_fee_cents from public.orders
      where tenant_id = ${ctx.tenantId} and idempotency_key = ${idempotencyKey}
      limit 1
    `;
    const won = raceWinner[0];
    if (won) {
      return {
        order_id: won.id,
        confirmed: true,
        total_cents: won.total_cents,
        ...(won.delivery_fee_cents ? { delivery_fee_cents: won.delivery_fee_cents } : {}),
      };
    }
    return { confirmed: false, reason: "item_not_found" };
  }
  if (!order) return { confirmed: false, reason: "item_not_found" };

  if (consentPayload && customerId) {
    await sql`
      update public.customers set consent = ${JSON.stringify(consentPayload)}::jsonb
      where id = ${customerId}
    `;
  }

  // GAP_REGISTER.md §1.7 — mirrors this call's captured order details onto
  // `call_logs.structured_booking_payload` (the same dashboard "Linked
  // booking" card column `create_booking.ts` writes), sourced from
  // whatever the model actually captured this call — skipped when there's
  // nothing beyond the priced items to add.
  if ((args.allergies && args.allergies.length > 0) || args.special_instructions) {
    await sql`
      update public.call_logs
      set structured_booking_payload = ${JSON.stringify({
        allergies: args.allergies ?? [],
        special_instructions: args.special_instructions ?? null,
      })}::jsonb
      where id = ${ctx.callLogId} and tenant_id = ${ctx.tenantId}
    `;
  }

  if (
    args.fulfillment_type === "delivery" &&
    args.delivery_address?.street &&
    customerId &&
    deps?.geocode
  ) {
    await saveDeliveryAddress(sql, ctx, logger, customerId, args.delivery_address, deps.geocode);
  }

  const messageRows = await sql<{ id: string }>`
    insert into public.messages_outbound (tenant_id, channel, recipient, template_key, payload, related_order_id)
    values (${ctx.tenantId}, 'sms', ${phone}, 'order_confirmation', ${JSON.stringify({ total_cents: totalCents })}::jsonb, ${order.id})
    returning id
  `;
  const message = messageRows[0];
  if (message) {
    await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: message.id });
  }

  // E2E_FLOWS_AUDIT B4 (producer side): the literal `adapter: "pos"` this
  // used to send matched no key in `worker-adapter-push`'s `ADAPTER_PUSHERS`
  // map (only real provider names — "square", "shopmonkey", "ezyvet",
  // "google_calendar" — are registered there), so every order push ever
  // enqueued this way silently dead-ended at `adapter_push_not_implemented`.
  // Addressing it to the tenant's own actually-connected adapter fixes that.
  await enqueueAdapterPush(sql, {
    tenantId: ctx.tenantId,
    entityType: "order",
    entityId: order.id,
    idempotencyKey,
  });

  return {
    order_id: order.id,
    confirmed: true,
    total_cents: totalCents,
    ...(deliveryFeeCents > 0 ? { delivery_fee_cents: deliveryFeeCents } : {}),
  };
}

/**
 * restaurant.md Finding B4: upserts the spoken delivery address onto
 * `customer_addresses`, matching an existing row by (customer, street —
 * case/whitespace-insensitive) and marking it (or a newly inserted row)
 * the caller's new default, so the NEXT order's radius check and
 * `lookup_customer`'s saved-address surface both have real data. Wrapped
 * so a geocode-provider or DB hiccup here never fails the order that's
 * already been confirmed and inserted above.
 */
async function saveDeliveryAddress(
  sql: SqlClient,
  ctx: CallContext,
  logger: Logger,
  customerId: string,
  address: {
    street: string;
    city?: string | undefined;
    state?: string | undefined;
    zip?: string | undefined;
  },
  geocode: { fetchImpl: GeocodeFetch; apiKey: string },
): Promise<void> {
  try {
    const geocoded = await geocodeAddress(geocode.fetchImpl, geocode.apiKey, address);
    if (!geocoded.ok || !geocoded.point) {
      logger.warn("create_order_geocode_failed", {
        call_id: ctx.retellCallId,
        tenant_id: ctx.tenantId,
        status: geocoded.status,
      });
      return;
    }

    const existing = await sql<{ id: string }>`
      select id from public.customer_addresses
      where tenant_id = ${ctx.tenantId} and customer_id = ${customerId}
        and lower(trim(street)) = lower(trim(${address.street}))
      limit 1
    `;

    await sql`
      update public.customer_addresses
      set is_default = false
      where tenant_id = ${ctx.tenantId} and customer_id = ${customerId} and is_default = true
    `;

    if (existing[0]) {
      await sql`
        update public.customer_addresses
        set city = ${address.city ?? null},
            state = ${address.state ?? null},
            zip = ${address.zip ?? null},
            geocode = point(${geocoded.point.lng}, ${geocoded.point.lat}),
            is_default = true
        where id = ${existing[0].id}
      `;
    } else {
      await sql`
        insert into public.customer_addresses (
          tenant_id, customer_id, street, city, state, zip, geocode, is_default
        ) values (
          ${ctx.tenantId}, ${customerId}, ${address.street},
          ${address.city ?? null}, ${address.state ?? null}, ${address.zip ?? null},
          point(${geocoded.point.lng}, ${geocoded.point.lat}), true
        )
      `;
    }
  } catch (err) {
    logger.warn("create_order_address_save_failed", {
      call_id: ctx.retellCallId,
      tenant_id: ctx.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
