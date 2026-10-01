import type { z } from "zod";
import { enqueueAdapterPush } from "../../_shared/adapter-push.ts";
import {
  checkDeliveryAddress,
  type DeliveryCheckStatus,
  findRecentDeliveryCheck,
  haversineMiles,
  loadDeliverySettings,
  resolveBusinessLocation,
  roundMiles,
} from "../../_shared/delivery-distance.ts";
import { computeDeliveryFeeCents } from "../../_shared/delivery-fee.ts";
import { orderIdempotencyKey } from "../../_shared/idempotency.ts";
import { normalizeE164 } from "../../_shared/phone.ts";
import type { CensusFetch } from "../../_shared/providers/census-geocode.ts";
import { enqueue, QUEUE_NAMES } from "../../_shared/queue.ts";
import type { CreateOrderArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { Logger, SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { MANUAL_MODE_ORDER_MESSAGE } from "../manual-mode.ts";
import { raiseOwnerAlert } from "../owner-alert-runner.ts";
import { dollars } from "./check_delivery_address.ts";

type Args = z.infer<typeof CreateOrderArgsSchema>;

interface OfferingRow {
  id: string;
  name: string;
  price_cents: number | null;
}

export type CreateOrderResult =
  | {
      order_id: string;
      confirmed: true;
      total_cents: number;
      delivery_fee_cents?: number;
      /** DELIVERY-1: present (false) only when a delivery address could not be verified. */
      address_verified?: false;
      message?: string;
    }
  | {
      confirmed: false;
      reason:
        | "item_not_found"
        | "out_of_delivery_radius"
        | "below_delivery_minimum"
        | "invalid_phone"
        | "manual_mode";
      item_name?: string;
      /** item_not_found: the menu's real item names, so the agent can pick the one the caller meant. */
      menu_items?: string[];
      pickup_offered?: boolean;
      /** below_delivery_minimum: the restaurant's delivery minimum and this order's subtotal. */
      delivery_minimum_cents?: number;
      subtotal_cents?: number;
      message?: string;
    };

/** DELIVERY-1: told to the agent with a confirmed order whose address was not verified. */
export const ADDRESS_UNVERIFIED_MESSAGE =
  "Order placed, but the delivery address could not be verified: tell the caller the " +
  "restaurant will confirm the address.";

/** DELIVERY-1: the inline address check's geocoder timeout when the agent skipped check_delivery_address. */
export const INLINE_CHECK_TIMEOUT_MS = 1_500;

const UNIQUE_VIOLATION = "23505";

/** Menu names returned with item_not_found; a restaurant catalog is tens of items, this only bounds a huge one. */
const MENU_ITEMS_IN_ERROR_MAX = 80;

function isPgError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === code;
}

/**
 * MASTER_SPEC §3.0 `create_order` tool (mirrors `create_booking`'s
 * idempotent-insert shape). Items are validated against `offerings` — a
 * tool-backed catalog, never model-invented pricing.
 *
 * DELIVERY-1 (docs/BUILD_NOTES.md): a delivery order's address is verified
 * against the restaurant's location and radius (`verifyDelivery` below):
 * a NEW address reuses this call's `check_delivery_address` result for the
 * same street, else is checked inline (US Census Geocoder, 1.5 s timeout);
 * a SAVED address (`address_id`) uses its stored geocode. Out of range ->
 * declined with a pickup offer. Below `tenants.delivery_min_order_cents` ->
 * `below_delivery_minimum`. The delivery fee is distance-based
 * (`_shared/delivery-fee.ts`). An address that could not be verified (not
 * found, geocoder down, business not located, no radius set) never blocks
 * the order: it is written with `orders.address_verification` set to that
 * status so the owner confirms it, and the agent is told to say so.
 *
 * restaurant.md Finding B4: a confirmed delivery order best-effort upserts
 * a freshly spoken address onto `customer_addresses` with the check's
 * location as its geocode, so a REPEAT caller's next order (and
 * `lookup_customer`) has a saved, located address. Only located addresses
 * are saved; a failure there never fails the order.
 *
 * PUBLISH-1 (docs/BUILD_NOTES.md): `is_test` mirrors `ctx.isTestCall`
 * directly, the SAME pattern `create_booking.ts` already established for
 * `bookings.is_test` (CALL-6) — never re-derived here — so a Retell
 * batch-test/simulator order is flagged from the moment it's written,
 * before the dashboard orders list or the header notification bell ever
 * reads it.
 */
export async function createOrder(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
  logger: Logger,
  deps?: {
    /** DELIVERY-1: Census Geocoder transport for the inline address check.
     * Absent = a new address that was not checked this call is recorded as
     * unverified (`lookup_unavailable`), never geocoded. */
    census?: { fetchImpl: CensusFetch; timeoutMs?: number } | undefined;
    /** VOICE-ALERTS-1: post-response scheduling for the owner alert. */
    defer?: ((label: string, task: () => Promise<void>) => void) | undefined;
  },
): Promise<CreateOrderResult> {
  // VOICE-ALERTS-1: Manual Mode - nothing is written; the agent takes a
  // message instead (flag rode in on the call context, no extra query).
  if (ctx.manualMode) {
    return { confirmed: false, reason: "manual_mode", message: MANUAL_MODE_ORDER_MESSAGE };
  }
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

  // CALL-7 (docs/BUILD_NOTES.md — recurring `restaurant` batch-test
  // failure, same class of gap OPS-5 already fixed for `create_booking`'s
  // `resource_id`): unlike vet/dental's `create_booking` flow, no
  // restaurant template state ever grants `list_offerings` — the menu is
  // presented to the model purely as prose (`{{menu_text}}`, `voice-
  // inbound/dynamic-variables.ts#resolveMenuText`), which never carries an
  // `offering_id`. `items[].offering_id` was never actually REQUIRED by
  // the tool's own schema either (`required: ["name","qty"]`,
  // `agent-template-seeds.ts`), so a model that only ever saw item NAMES
  // had no way to supply one — live-confirmed: every `create_order` call
  // arrived with `offering_id` entirely absent, always failing
  // `item_not_found` on an otherwise perfectly real, spoken menu item,
  // three retries in a row, until the model gave up and looped/tried to
  // transfer. Fixed the same way: resolve each item's offering server-
  // side — exact `offering_id` match first (the fast path when a future
  // vertical DOES grant `list_offerings`), falling back to a case-
  // insensitive `name` match against this tenant's active offerings
  // (the name the model already spoke, taken straight from the same
  // `menu_text` it was given) — never inventing a price, only matching an
  // EXISTING catalog row.
  // Fetches every ACTIVE offering for this tenant (not filtered to the
  // requested ids/names) — a restaurant's catalog is small (tens of items
  // at most, never a hot-availability-style table), and fetching it whole
  // lets the name-fallback below match case-insensitively/robustly in JS
  // without a second round trip or a fragile SQL `lower(name) = any(...)`
  // array comparison.
  const offeringRows = await sql<OfferingRow>`
    select id, name, price_cents from public.offerings
    where tenant_id = ${ctx.tenantId} and active
  `;
  const offeringsById = new Map(offeringRows.map((o) => [o.id, o]));
  const offeringsByLowerName = new Map(offeringRows.map((o) => [o.name.toLowerCase(), o]));

  let subtotalCents = 0;
  const priced: {
    offering_id: string | null;
    name: string;
    qty: number;
    unit_price_cents: number;
    modifiers: string[];
  }[] = [];
  for (const item of args.items) {
    const offering =
      (item.offering_id ? offeringsById.get(item.offering_id) : undefined) ??
      offeringsByLowerName.get(item.name.toLowerCase());
    if (!offering || offering.price_cents === null) {
      // Still exact names only (never an off-menu item or a guessed dish): the
      // model maps what the caller said to a menu item itself, and gets the
      // real names back so it can correct a caller's wording without stalling
      // (live QA 2026-09-30: "Chicken Biryani" vs the menu's full name looped
      // until the 3-minute cap).
      const menuItems = offeringRows
        .filter((o) => o.price_cents !== null)
        .map((o) => o.name)
        .slice(0, MENU_ITEMS_IN_ERROR_MAX);
      return {
        confirmed: false,
        reason: "item_not_found",
        item_name: item.name,
        ...(menuItems.length > 0 ? { menu_items: menuItems } : {}),
      };
    }
    if (offering.id !== item.offering_id) {
      logger.warn("create_order_offering_id_resolved_by_name_fallback", {
        tenant_id: ctx.tenantId,
        requested_offering_id: item.offering_id ?? null,
        requested_name: item.name,
        resolved_offering_id: offering.id,
      });
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
  // it here, server-side, to the real saved fields/geocode. Scoped by phone
  // (the `customers` upsert runs later). A stale/foreign address_id keeps
  // the id with no resolved fields — never an invented address.
  let resolvedDeliveryAddress: typeof args.delivery_address = args.delivery_address;
  let savedGeocode: { x: number; y: number } | null = null;
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
      savedGeocode = saved.geocode;
    }
  }

  // DELIVERY-1: verify the delivery address, enforce the radius and the
  // delivery minimum, and price the delivery by distance, all from the
  // tenant's own columns (`loadDeliverySettings`, which falls back to the
  // older dynamic_variable_overrides keys only where those are unset).
  let delivery: DeliveryOutcome | null = null;
  if (args.fulfillment_type === "delivery") {
    delivery = await verifyDelivery(sql, ctx, logger, {
      address: resolvedDeliveryAddress,
      savedGeocode,
      census: deps?.census,
    });
    if (delivery.status === "out_of_range") {
      return { confirmed: false, reason: "out_of_delivery_radius", pickup_offered: true };
    }
    const minimum = delivery.minOrderCents;
    if (minimum !== null && minimum > 0 && subtotalCents < minimum) {
      return {
        confirmed: false,
        reason: "below_delivery_minimum",
        delivery_minimum_cents: minimum,
        subtotal_cents: subtotalCents,
        pickup_offered: true,
        message:
          `Delivery orders need at least ${dollars(minimum)} of food; this order is ` +
          `${dollars(subtotalCents)}. Offer to add items, or switch to pickup.`,
      };
    }
  }

  const taxRateBps = typeof overrides["tax_rate_bps"] === "number" ? overrides["tax_rate_bps"] : 0;
  const taxCents = Math.round((subtotalCents * taxRateBps) / 10_000);
  // DELIVERY-1: base + ceil(per_mile * max(0, miles - included)) from the
  // tenant's delivery-fee columns (`_shared/delivery-fee.ts`); base only when
  // the distance is unknown. 0 for pickup/dine_in and an unset policy.
  const deliveryFeeCents = delivery?.deliveryFeeCents ?? 0;
  const addressVerification = delivery?.status ?? null;
  const addressVerified = addressVerification === null || addressVerification === "in_range";
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
        allergies, special_instructions, is_test, address_verification
      ) values (
        ${ctx.tenantId}, ${customerId}, ${priced}::jsonb, ${args.fulfillment_type},
        ${resolvedDeliveryAddress ?? null}::jsonb,
        ${subtotalCents}, ${taxCents}, ${deliveryFeeCents}, ${totalCents}, ${ctx.callLogId}, ${idempotencyKey},
        ${args.allergies && args.allergies.length > 0 ? args.allergies : null},
        ${args.special_instructions ?? null}, ${ctx.isTestCall}, ${addressVerification}
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
      update public.customers set consent = ${consentPayload}::jsonb
      where id = ${customerId}
    `;
  }

  // GAP_REGISTER.md §1.7 — mirrors this call's captured order details onto
  // `call_logs.structured_booking_payload` (the same dashboard "Linked
  // booking" card column `create_booking.ts` writes), sourced from
  // whatever the model actually captured this call — skipped when there's
  // nothing beyond the priced items to add.
  //
  // CALL-8 (docs/BUILD_PLAN.md): merge (`coalesce(...) || ...`), matching
  // `create_booking.ts`'s identical fix and `take_message.ts`'s own
  // pre-existing merge pattern — a straight overwrite here would silently
  // erase whatever an earlier tool call in the same call_logs row already
  // recorded (e.g. a `take_message` call's `caller_name`/`caller_phone`).
  if ((args.allergies && args.allergies.length > 0) || args.special_instructions) {
    await sql`
      update public.call_logs
      set structured_booking_payload = coalesce(structured_booking_payload, '{}'::jsonb) || ${{
        allergies: args.allergies ?? [],
        special_instructions: args.special_instructions ?? null,
      }}::jsonb
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
    } else if (delivery?.location) {
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
          delivery.location,
          setAsDefault,
        );
      }
    }
  }

  const messageRows = await sql<{ id: string }>`
    insert into public.messages_outbound (tenant_id, channel, recipient, template_key, payload, related_order_id)
    values (${ctx.tenantId}, 'sms', ${phone}, 'order_confirmation', ${{ total_cents: totalCents }}::jsonb, ${order.id})
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

  // VOICE-ALERTS-1: tell the owner about the new order (after everything
  // the caller is waiting on; deferred past the response when the hot path
  // gave us a `defer`). Idempotent per order, best-effort, never for a test
  // call, delivery channel per the tenant's preferences.
  await raiseOwnerAlert(sql, ctx, { logger, defer: deps?.defer }, "create_order_owner_alert", {
    kind: "new_order",
    payload: {
      ...(args.customer.name ? { caller_name: args.customer.name } : {}),
      caller_phone: phone,
      fulfillment_type: args.fulfillment_type,
      items_summary: summarizeItems(priced),
      total_cents: totalCents,
    },
    relatedCallId: ctx.callLogId,
    relatedOrderId: order.id,
  });

  return {
    order_id: order.id,
    confirmed: true,
    total_cents: totalCents,
    ...(deliveryFeeCents > 0 ? { delivery_fee_cents: deliveryFeeCents } : {}),
    ...(addressVerified ? {} : { address_verified: false, message: ADDRESS_UNVERIFIED_MESSAGE }),
  };
}

/** DELIVERY-1: what `verifyDelivery` decided for a delivery order. */
interface DeliveryOutcome {
  /** Never `out_of_range` on a written order (that declines the order instead). */
  status: DeliveryCheckStatus;
  distanceMiles: number | null;
  deliveryFeeCents: number;
  minOrderCents: number | null;
  /** The caller's address location, when known (saved onto customer_addresses). */
  location: { lat: number; lng: number } | null;
}

const NO_GEOCODER: CensusFetch = () => Promise.reject(new Error("no_geocoder_configured"));

/**
 * DELIVERY-1: classify a delivery order's address. One settings read, plus:
 *  - a SAVED address (`address_id`) with a stored geocode: distance from the
 *    business's cached (or freshly geocoded) location — no caller geocode;
 *  - otherwise (a new address, or a saved one with no geocode): this call's
 *    latest `delivery_address_checks` row for the same street, else an inline
 *    `checkDeliveryAddress` (only when a geocoder is wired).
 * The delivery fee uses the distance when known, the base fee otherwise.
 */
async function verifyDelivery(
  sql: SqlClient,
  ctx: CallContext,
  logger: Logger,
  input: {
    address: Args["delivery_address"];
    savedGeocode: { x: number; y: number } | null;
    census: { fetchImpl: CensusFetch; timeoutMs?: number } | undefined;
  },
): Promise<DeliveryOutcome> {
  let settings: Awaited<ReturnType<typeof loadDeliverySettings>> = null;
  try {
    settings = await loadDeliverySettings(sql, ctx.tenantId);
  } catch (err) {
    logger.warn("create_order_delivery_settings_read_failed", {
      tenant_id: ctx.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const fee = settings?.fee ?? { baseCents: null, perMileCents: null, includedMiles: null };
  const minOrderCents = settings?.minOrderCents ?? null;
  const outcome = (
    status: DeliveryCheckStatus,
    distanceMiles: number | null,
    location: { lat: number; lng: number } | null,
  ): DeliveryOutcome => ({
    status,
    distanceMiles,
    deliveryFeeCents: computeDeliveryFeeCents(fee, distanceMiles),
    minOrderCents,
    location,
  });
  const geocoderDeps = {
    fetchImpl: input.census?.fetchImpl ?? NO_GEOCODER,
    timeoutMs: input.census?.timeoutMs ?? INLINE_CHECK_TIMEOUT_MS,
    logger,
  };

  // A saved address with a stored geocode: postgres.js returns a `point` as
  // {x: lng, y: lat}.
  if (input.savedGeocode) {
    const caller = { lat: input.savedGeocode.y, lng: input.savedGeocode.x };
    if (!settings) return outcome("no_business_location", null, caller);
    const business = await resolveBusinessLocation(sql, settings, geocoderDeps);
    if (!business.ok) return outcome("no_business_location", null, caller);
    const distance = roundMiles(haversineMiles(business.location, caller));
    if (settings.radiusMiles === null) return outcome("no_radius_set", distance, caller);
    return outcome(
      distance <= settings.radiusMiles ? "in_range" : "out_of_range",
      distance,
      caller,
    );
  }

  const street = input.address?.street;
  if (!street) {
    // A stale/foreign address_id with nothing to check.
    logger.warn("create_order_delivery_address_unresolved", {
      call_id: ctx.retellCallId,
      tenant_id: ctx.tenantId,
    });
    return outcome("not_found", null, null);
  }

  try {
    const prior = await findRecentDeliveryCheck(sql, ctx.tenantId, ctx.retellCallId, street);
    if (prior) {
      const location =
        prior.lat !== null && prior.lng !== null ? { lat: prior.lat, lng: prior.lng } : null;
      return outcome(prior.status, prior.distanceMiles, location);
    }
  } catch (err) {
    logger.warn("create_order_delivery_check_read_failed", {
      tenant_id: ctx.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!input.census) {
    logger.warn("create_order_delivery_address_not_checked", {
      call_id: ctx.retellCallId,
      tenant_id: ctx.tenantId,
    });
    return outcome("lookup_unavailable", null, null);
  }
  const check = await checkDeliveryAddress(
    sql,
    { tenantId: ctx.tenantId, providerCallId: ctx.retellCallId },
    {
      street,
      city: input.address?.city,
      state: input.address?.state,
      zip: input.address?.zip,
    },
    { ...geocoderDeps, settings },
  );
  const location =
    check.lat !== null && check.lng !== null ? { lat: check.lat, lng: check.lng } : null;
  return outcome(check.status, check.distanceMiles, location);
}

/** "2x Burger, 1x Fries" for an owner alert, capped so an SMS stays short. */
function summarizeItems(items: { name: string; qty: number }[]): string {
  const text = items.map((i) => `${i.qty}x ${i.name}`).join(", ");
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
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
 * real bug this fixes). The location comes from the address check (DELIVERY-1).
 * Wrapped so a DB hiccup here
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
  point: { lat: number; lng: number },
  setAsDefault: boolean,
): Promise<void> {
  try {
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
            geocode = point(${point.lng}, ${point.lat}),
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
          point(${point.lng}, ${point.lat}), ${shouldBeDefault}
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
