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
 * plus ONE way to reach platform_settings:
 *   SUPABASE_URL + SUPABASE_SECRET_KEY        PostgREST with the project's
 *                             secret key (sb_secret_… goes in `apikey` only;
 *                             a legacy JWT key also goes in Authorization)
 *   or SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN   the Management API
 *                             raw-SQL endpoint (same one
 *                             scripts/republish-fleet.ts uses)
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
function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

const SUPABASE_URL = optionalEnv("SUPABASE_URL");
const SUPABASE_SECRET_KEY = optionalEnv("SUPABASE_SECRET_KEY");
const SUPABASE_PROJECT_REF = optionalEnv("SUPABASE_PROJECT_REF");
const SUPABASE_ACCESS_TOKEN = optionalEnv("SUPABASE_ACCESS_TOKEN");
const USE_MANAGEMENT_API = !!(SUPABASE_PROJECT_REF && SUPABASE_ACCESS_TOKEN);
if (!USE_MANAGEMENT_API && !(SUPABASE_URL && SUPABASE_SECRET_KEY)) {
  console.error(
    "Missing database access: set SUPABASE_URL + SUPABASE_SECRET_KEY, or SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN",
  );
  process.exit(1);
}

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
  const key = SUPABASE_SECRET_KEY as string;
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  // New sb_secret_… keys are not JWTs: sending one as a Bearer token makes the
  // gateway reject the request. Only a legacy JWT key goes in Authorization.
  if (key.split(".").length === 3) headers["Authorization"] = `Bearer ${key}`;
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, json: text ? JSON.parse(text) : undefined };
}

async function managementQuery(query: string): Promise<unknown> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API query failed: status ${res.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}

/** Dollar-quotes a JSON document for the Management API SQL path. */
function sqlJsonLiteral(value: unknown): string {
  const json = JSON.stringify(value);
  if (json.includes("$pc$")) throw new Error("price card JSON contains the quote tag");
  return `$pc$${json}$pc$::jsonb`;
}

/** Reads one price card; undefined only when the row truly does not exist. */
async function readPriceCard(key: string): Promise<PriceCardValue | undefined> {
  if (USE_MANAGEMENT_API) {
    const rows = (await managementQuery(
      `select value from public.platform_settings where key = '${key}'`,
    )) as Array<{ value: PriceCardValue }>;
    return rows[0]?.value;
  }
  const res = await supabaseRest(
    "GET",
    `/rest/v1/platform_settings?key=eq.${encodeURIComponent(key)}&select=value`,
  );
  if (!res.ok)
    throw new Error(`Failed to read ${key}: status ${res.status} ${JSON.stringify(res.json)}`);
  return (res.json as Array<{ value: PriceCardValue }>)[0]?.value;
}

async function writePriceCard(key: string, value: PriceCardValue): Promise<void> {
  if (USE_MANAGEMENT_API) {
    await managementQuery(
      `update public.platform_settings set value = ${sqlJsonLiteral(value)} where key = '${key}'`,
    );
    return;
  }
  const res = await supabaseRest(
    "PATCH",
    `/rest/v1/platform_settings?key=eq.${encodeURIComponent(key)}`,
    { value },
  );
  if (!res.ok) throw new Error(`Failed to write ${key}: status ${res.status}`);
}

// Must match packages/canonical-types/src/vertical.ts VERTICALS (the
// platform_settings keys are price_card_<vertical>); scripts/ stays
// dependency-free, so the list is repeated here.
const VERTICALS = [
  "auto",
  "vet",
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
    // Required by POST /v1/billing/meters (docs.stripe.com/api/billing/meter/create):
    // job-billing-cycle reports minutes per event, so the meter sums them.
    default_aggregation: { formula: "sum" },
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
  const current = await readPriceCard(key);
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

  await writePriceCard(key, merged);
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
