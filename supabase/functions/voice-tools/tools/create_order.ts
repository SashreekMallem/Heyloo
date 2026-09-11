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

  // CHANNELS-2 item 10: when the caller picked one of SEVERAL saved
  // addresses (`lookup_customer`'s bounded, labeled list), the model sends
  // that row's id instead of re-speaking street/city/state/zip — resolve
  // it here, server-side, to the real saved fields/geocode. Deliberately
  // scoped by phone (not `customerId`, which doesn't exist yet — the
  // `customers` upsert runs later) the same way the pre-existing radius-
  // check query below already is, so this never needs to reorder the
  // customer-creation step to run early.
  let resolvedDeliveryAddress: typeof args.delivery_address = args.delivery_address;
  let resolvedGeocode: { x: number; y: number } | null = null;
  if (args.fulfillment_type === "delivery" && args.delivery_address?.address_id) {
    const savedRows = await sql<{
      street: string;
      city: string | null;
      state: string | null;
      zip: string | null;
      geocode: { x: number; y: number } | null;
    }>`
      select ca.street, ca.city, ca.state, ca.zip, ca.geocode
      from public.customer_addresses ca
      join public.customers c on c.id = ca.customer_id
      where c.tenant_id = ${ctx.tenantId} and c.phone_e164 = ${phone}
        and ca.id = ${args.delivery_address.address_id}
      limit 1
    `;
    const saved = savedRows[0];
    if (saved) {
      resolvedDeliveryAddress = {
        address_id: args.delivery_address.address_id,
        street: saved.street,
        ...(saved.city ? { city: saved.city } : {}),
        ...(saved.state ? { state: saved.state } : {}),
        ...(saved.zip ? { zip: saved.zip } : {}),
        ...(args.delivery_address.set_as_default ? { set_as_default: true } : {}),
      };
      resolvedGeocode = saved.geocode;
    }
    // A stale/foreign address_id (deleted, or belongs to a different
    // caller) simply falls through with the id kept but no resolved
    // fields — never invents an address, and the radius check below
    // degrades to its existing "no caller geocode" skip-with-warning path.
  }

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
      // format. Prefer the address the caller actually CHOSE (resolved
      // above) over always defaulting to their saved default — a repeat
      // caller with multiple addresses picking a non-default one must be
      // checked against THAT address's radius, not their default's.
      const callerGeocode =
        resolvedGeocode ??
        (
          await sql<{ geocode: { x: number; y: number } | null }>`
        select ca.geocode
        from public.customer_addresses ca
        join public.customers c on c.id = ca.customer_id
        where c.tenant_id = ${ctx.tenantId} and c.phone_e164 = ${phone} and ca.geocode is not null
        order by ca.is_default desc, ca.created_at desc
        limit 1
      `
        )[0]?.geocode;

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
        ${resolvedDeliveryAddress ? JSON.stringify(resolvedDeliveryAddress) : null}::jsonb,
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

  if (args.fulfillment_type === "delivery" && customerId) {
    const addressId = args.delivery_address?.address_id;
    const setAsDefault = args.delivery_address?.set_as_default === true;
    if (addressId) {
      // Reused a saved address (resolved above) — nothing new to persist,
      // only promote it to the default if the caller explicitly asked.
      // A stale/unresolved address_id is left alone rather than guessed at
      // (see the resolution block's own comment).
      if (setAsDefault) {
        await markAddressDefault(sql, ctx, customerId, addressId);
      }
    } else if (deps?.geocode) {
      const street = args.delivery_address?.street;
      if (street) {
        // CHANNELS-2 item 10(d): a freshly spoken address is always saved
        // as an ADDITIONAL entry (or updated in place if it matches an
        // existing one by street) — it becomes the default only when this
        // is the customer's first saved address at all, or the caller
        // explicitly asked (`set_as_default`). See `saveDeliveryAddress`'s
        // own docstring — this used to unconditionally clear and steal
        // every existing default, a real bug this fixes.
        await saveDeliveryAddress(
          sql,
          ctx,
          logger,
          customerId,
          {
            street,
            city: args.delivery_address?.city,
            state: args.delivery_address?.state,
            zip: args.delivery_address?.zip,
          },
          deps.geocode,
          setAsDefault,
        );
      }
    }
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
 * CHANNELS-2 item 10(d): a caller explicitly setting an existing saved
 * address as their new default — clears every other default first (a
 * customer has at most one default address at a time), then marks this
 * one. Never called just because an address was used/added; only on an
 * explicit `set_as_default`.
 */
async function markAddressDefault(
  sql: SqlClient,
  ctx: CallContext,
  customerId: string,
  addressId: string,
): Promise<void> {
  await sql`
    update public.customer_addresses
    set is_default = false
    where tenant_id = ${ctx.tenantId} and customer_id = ${customerId} and is_default = true
  `;
  await sql`
    update public.customer_addresses
    set is_default = true
    where tenant_id = ${ctx.tenantId} and customer_id = ${customerId} and id = ${addressId}
  `;
}

/**
 * restaurant.md Finding B4 / CHANNELS-2 item 10(d): upserts a freshly
 * SPOKEN delivery address onto `customer_addresses`, matching an existing
 * row by (customer, street — case/whitespace-insensitive) so a caller who
 * repeats the same address updates it in place rather than accumulating
 * duplicates; a genuinely different address is always saved as an
 * ADDITIONAL entry, never a replacement of any existing one. Becomes the
 * customer's default only when (a) they have no default address yet (this
 * is their first saved address), or (b) `setAsDefault` — the caller
 * explicitly said to make this their new default. Otherwise an existing
 * default is left completely untouched (this function used to
 * unconditionally clear and steal it on every single delivery order — a
 * real bug this fixes). Wrapped so a geocode-provider or DB hiccup here
 * never fails the order that's already been confirmed and inserted above.
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
  setAsDefault: boolean,
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

    const existing = await sql<{ id: string; is_default: boolean }>`
      select id, is_default from public.customer_addresses
      where tenant_id = ${ctx.tenantId} and customer_id = ${customerId}
        and lower(trim(street)) = lower(trim(${address.street}))
      limit 1
    `;
    const existingIsAlreadyDefault = existing[0]?.is_default === true;

    const defaultRows = await sql<{ id: string }>`
      select id from public.customer_addresses
      where tenant_id = ${ctx.tenantId} and customer_id = ${customerId} and is_default = true
      limit 1
    `;
    const hasAnyDefault = !!defaultRows[0];
    // This row becomes/stays the default when: the caller asked for it,
    // it's already the default (correcting its own details never demotes
    // it), or there simply isn't a default yet (first saved address).
    const shouldBeDefault = setAsDefault || existingIsAlreadyDefault || !hasAnyDefault;

    if (shouldBeDefault && !existingIsAlreadyDefault) {
      await sql`
        update public.customer_addresses
        set is_default = false
        where tenant_id = ${ctx.tenantId} and customer_id = ${customerId} and is_default = true
      `;
    }

    if (existing[0]) {
      await sql`
        update public.customer_addresses
        set city = ${address.city ?? null},
            state = ${address.state ?? null},
            zip = ${address.zip ?? null},
            geocode = point(${geocoded.point.lng}, ${geocoded.point.lat}),
            is_default = ${shouldBeDefault}
        where id = ${existing[0].id}
      `;
    } else {
      await sql`
        insert into public.customer_addresses (
          tenant_id, customer_id, street, city, state, zip, geocode, is_default
        ) values (
          ${ctx.tenantId}, ${customerId}, ${address.street},
          ${address.city ?? null}, ${address.state ?? null}, ${address.zip ?? null},
          point(${geocoded.point.lng}, ${geocoded.point.lat}), ${shouldBeDefault}
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
