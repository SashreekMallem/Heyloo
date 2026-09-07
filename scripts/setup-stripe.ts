/**
 * One-time Stripe setup (BACKEND_SPEC §7.9 provisioning saga step 5 /
 * API_AND_FLOWS.md A.3 "Billing Meters"): creates the platform-level
 * Billing Meter for metered call-minutes usage, then for every vertical in
 * `platform_settings.price_card_<vertical>` creates a Stripe Product plus a
 * licensed (base-fee) Price and a metered (overage) Price backed by that
 * Meter — and writes the resulting Stripe ids back onto each price-card row
 * (`stripe_meter_id`, `stripe_product_id`, `stripe_base_price_id`,
 * `stripe_meter_price_id`) so `/api-checkout` (T4) can look them up.
 *
 * Idempotent by design (safe to re-run): a price-card row that already
 * carries `stripe_base_price_id`+`stripe_meter_price_id` is skipped
 * entirely; the Meter is looked up by `event_name` first and only created
 * if none exists. Re-running after a partial failure may leave one or two
 * orphan (unused) Stripe Products from an earlier attempt for a vertical
 * that later succeeded on a subsequent run — a cheap, inert cost, never a
 * correctness problem (nothing references an orphan Product/Price).
 *
 * Dependency-free by design, matching `scripts/ci/rls-cross-tenant-probe.ts`
 * (T1) — plain Node `fetch` against Stripe's REST API and Supabase's
 * PostgREST (no `stripe`/`@supabase/supabase-js` package, so this stays
 * outside the pnpm workspace's dependency graph, which `scripts/` must not
 * grow per that file's own precedent). Erasable-TypeScript syntax only, run
 * via:
 *   node --experimental-strip-types scripts/setup-stripe.ts
 *
 * Required env vars (see .env.example):
 *   STRIPE_SECRET_KEY
 *   STRIPE_METER_EVENT_NAME   the Billing Meter's event_name (must match
 *                             what job-billing-cycle reports usage under)
 *   SUPABASE_URL              e.g. https://<project-ref>.supabase.co
 *   SUPABASE_SECRET_KEY       service-role/secret key (bypasses RLS)
 *
 * VERIFY (docs/VERIFY.md): Stripe Billing Meters / metered-Price field names
 * below are the indexed-search-confirmed 2026 shape (`docs.stripe.com` is
 * egress-blocked in this build, per CLAUDE.md Rule 1 item 2) — confirm
 * against a live Stripe test-mode account before the first real run.
 */

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

const STRIPE_SECRET_KEY = env("STRIPE_SECRET_KEY");
const STRIPE_METER_EVENT_NAME = env("STRIPE_METER_EVENT_NAME");
const SUPABASE_URL = env("SUPABASE_URL");
const SUPABASE_SECRET_KEY = env("SUPABASE_SECRET_KEY");

const STRIPE_BASE_URL = "https://api.stripe.com/v1";

function flatten(
  value: unknown,
  prefix = "",
  out: Record<string, string> = {},
): Record<string, string> {
  if (value === undefined || value === null) return out;
  if (typeof value === "object" && !Array.isArray(value)) {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}[${key}]` : key, out);
    }
    return out;
  }
  out[prefix] = String(value);
  return out;
}

async function stripeRequest(
  method: "GET" | "POST",
  path: string,
  params?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const query = method === "GET" && params ? `?${new URLSearchParams(flatten(params))}` : "";
  const res = await fetch(`${STRIPE_BASE_URL}${path}${query}`, {
    method,
    headers: {
      authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    ...(method === "POST" && params
      ? { body: new URLSearchParams(flatten(params)).toString() }
      : {}),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

async function supabaseRest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, json: text ? JSON.parse(text) : undefined };
}

const VERTICALS = [
  "auto_repair",
  "veterinary",
  "legal",
  "dental",
  "real_estate",
  "motel",
  "restaurant",
  "generic",
] as const;

async function ensureMeter(): Promise<string> {
  const list = await stripeRequest("GET", "/billing/meters", { limit: 100 });
  const meters = (list.body["data"] as Array<Record<string, unknown>> | undefined) ?? [];
  const existing = meters.find((m) => m["event_name"] === STRIPE_METER_EVENT_NAME);
  if (existing?.["id"]) {
    console.log(`Meter already exists: ${existing["id"]}`);
    return existing["id"] as string;
  }

  const created = await stripeRequest("POST", "/billing/meters", {
    display_name: "Heyloo call minutes",
    event_name: STRIPE_METER_EVENT_NAME,
    customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
    value_settings: { event_payload_key: "value" },
  });
  if (!created.ok || !created.body["id"]) {
    throw new Error(`Failed to create Billing Meter: ${JSON.stringify(created.body)}`);
  }
  console.log(`Created meter: ${created.body["id"]}`);
  return created.body["id"] as string;
}

interface PriceCardValue {
  base_cents: number;
  included_minutes: number;
  overage_cents: number;
  stripe_meter_id?: string;
  stripe_product_id?: string;
  stripe_base_price_id?: string;
  stripe_meter_price_id?: string;
}

async function setupVertical(vertical: string, meterId: string): Promise<void> {
  const key = `price_card_${vertical}`;
  const rows = await supabaseRest(
    "GET",
    `/rest/v1/platform_settings?key=eq.${encodeURIComponent(key)}&select=value`,
  );
  const existingRows = rows.json as Array<{ value: PriceCardValue }> | undefined;
  const current = existingRows?.[0]?.value;
  if (!current) {
    console.warn(`Skipping ${vertical}: no ${key} row in platform_settings (seed missing).`);
    return;
  }
  if (current.stripe_base_price_id && current.stripe_meter_price_id) {
    console.log(`Skipping ${vertical}: already has Stripe price ids.`);
    return;
  }

  const product = await stripeRequest("POST", "/products", { name: `Heyloo — ${vertical}` });
  if (!product.ok || !product.body["id"]) {
    throw new Error(`Failed to create product for ${vertical}: ${JSON.stringify(product.body)}`);
  }
  const productId = product.body["id"] as string;

  const basePrice = await stripeRequest("POST", "/prices", {
    product: productId,
    unit_amount: current.base_cents,
    currency: "usd",
    recurring: { interval: "month" },
    nickname: `${vertical} base`,
  });
  if (!basePrice.ok || !basePrice.body["id"]) {
    throw new Error(
      `Failed to create base price for ${vertical}: ${JSON.stringify(basePrice.body)}`,
    );
  }

  const meterPrice = await stripeRequest("POST", "/prices", {
    product: productId,
    unit_amount: current.overage_cents,
    currency: "usd",
    billing_scheme: "per_unit",
    recurring: { interval: "month", meter: meterId, usage_type: "metered" },
    nickname: `${vertical} overage minutes`,
  });
  if (!meterPrice.ok || !meterPrice.body["id"]) {
    throw new Error(
      `Failed to create metered price for ${vertical}: ${JSON.stringify(meterPrice.body)}`,
    );
  }

  const merged: PriceCardValue = {
    ...current,
    stripe_meter_id: meterId,
    stripe_product_id: productId,
    stripe_base_price_id: basePrice.body["id"] as string,
    stripe_meter_price_id: meterPrice.body["id"] as string,
  };

  const update = await supabaseRest(
    "PATCH",
    `/rest/v1/platform_settings?key=eq.${encodeURIComponent(key)}`,
    { value: merged },
  );
  if (!update.ok) {
    throw new Error(`Failed to write price ids back for ${vertical}: status ${update.status}`);
  }
  console.log(
    `${vertical}: product=${productId} base=${basePrice.body["id"]} meter_price=${meterPrice.body["id"]}`,
  );
}

async function main(): Promise<void> {
  const meterId = await ensureMeter();
  for (const vertical of VERTICALS) {
    await setupVertical(vertical, meterId);
  }
  console.log("Stripe setup complete.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
