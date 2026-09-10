/**
 * Per-vertical dynamic-variable resolution (GAP_REGISTER.md §1.3/§1.6).
 *
 * Every compiled prompt's `{{token}}` placeholders are enumerated in
 * `packages/templates/src/red-team/prompt-lint.ts`'s
 * `ALLOWED_DYNAMIC_VARIABLES` — this file resolves each vertical-specific
 * one from `agent_configs.dynamic_variable_overrides` (a tenant-configured
 * jsonb blob, never trusted to be well-shaped) with a safe, non-
 * hallucinated default for every field, so a literal `{{token}}` string
 * (or a silently-missing dynamic variable) never reaches the model —
 * BUILD task requirement, per-vertical config gaps for auto/legal/motel/
 * restaurant. `cancellation_policy_text` is universal (spoken by every
 * booking vertical's `CANCELLATION_POLICY_READOUT_FRAGMENT`) and resolved
 * for every tenant regardless of vertical — harmless where a template
 * doesn't reference it.
 *
 * Money renders in whole-dollar strings for speech (`formatUsd`), read
 * from the same integer-cents values enforced everywhere else in this
 * repo (CLAUDE.md Rule 2). Every resolver here is pure/sync EXCEPT
 * `resolveMenuText`, which needs one extra indexed `public.offerings` read
 * — and only for a restaurant tenant that hasn't set a `menu_text`
 * override — kept off the hot path for every other vertical/tenant to
 * respect `/voice-inbound`'s p95<300ms budget (SYSTEM_DESIGN §5). A real
 * cache (e.g. a rendered-menu column maintained by a trigger on
 * `offerings`) is a documented follow-up — see docs/BUILD_NOTES.md's
 * Cluster B entry — rather than something this task can add on its own,
 * since `supabase/migrations/**` isn't in this task's ownership.
 */

import type { Logger, SqlClient } from "../_shared/types.ts";

export interface OfferingRow {
  name: string;
  price_cents: number | null;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Oxford-comma join: "A", "A and B", "A, B, and C". */
function renderList(items: string[]): string {
  const clean = items.map((i) => i.trim()).filter((i) => i.length > 0);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0] as string;
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function strArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? (value as string[])
    : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const DEFAULT_CANCELLATION_POLICY_TEXT =
  "we ask that you let us know as soon as possible if you need to cancel or reschedule";

/** Universal — spoken by auto/vet/dental/motel/restaurant's cancellation-policy fragment. */
export function resolveCancellationPolicyText(overrides: Record<string, unknown>): string {
  const policy = obj(overrides["cancellation_policy"]);
  return str(policy?.["text"]) ?? DEFAULT_CANCELLATION_POLICY_TEXT;
}

/** Legal: {{practice_areas}}, {{consult_fee_text}} (the fee guardrail's own enforcement number). */
export function resolveLegalTokens(overrides: Record<string, unknown>): Record<string, string> {
  const practiceAreas = strArray(overrides["practice_areas"]);
  const consultFeeCents = num(overrides["consult_fee_cents"]);
  return {
    practice_areas:
      practiceAreas && practiceAreas.length > 0
        ? renderList(practiceAreas)
        : "a broad range of legal matters",
    consult_fee_text:
      consultFeeCents !== undefined
        ? `${formatUsd(consultFeeCents)} for an initial consultation`
        : "an amount an attorney will confirm with you directly",
  };
}

/** Auto: {{tow_partner_name}}, {{tow_partner_phone}}, {{vehicle_makes_serviced}}. */
export function resolveAutoTokens(overrides: Record<string, unknown>): Record<string, string> {
  const towPartner = obj(overrides["tow_partner"]);
  const makes = strArray(overrides["vehicle_makes_serviced"]);
  return {
    tow_partner_name: str(towPartner?.["name"]) ?? "our recommended tow partner",
    tow_partner_phone: str(towPartner?.["phone"]) ?? "the number our team will provide",
    vehicle_makes_serviced:
      makes && makes.length > 0 ? renderList(makes) : "all major makes and models",
  };
}

/** Vet: {{species_treated}}, {{emergency_referral_name}}, {{emergency_referral_phone}}. */
export function resolveVetTokens(overrides: Record<string, unknown>): Record<string, string> {
  const species = strArray(overrides["species_treated"]);
  const referral = obj(overrides["emergency_referral"]);
  return {
    species_treated: species && species.length > 0 ? renderList(species) : "cats and dogs",
    emergency_referral_name: str(referral?.["name"]) ?? "the nearest emergency animal hospital",
    emergency_referral_phone: str(referral?.["phone"]) ?? "a number we'll follow up with",
  };
}

interface RateTableEntry {
  room_type: string;
  nightly_rate_cents: number;
}

function rateTableEntries(value: unknown): RateTableEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((e): e is RateTableEntry => {
    const entry = obj(e);
    return (
      typeof entry?.["room_type"] === "string" && typeof entry?.["nightly_rate_cents"] === "number"
    );
  });
}

/**
 * Motel: {{rate_table}} (the rate-discipline fragment's ONLY source of
 * truth — an empty/unset table renders as an explicit "no rates on file"
 * so the model naturally defers instead of inventing a number) and
 * {{deposit_policy_text}}.
 */
export function resolveMotelTokens(overrides: Record<string, unknown>): Record<string, string> {
  const depositPolicy = obj(overrides["deposit_policy"]);
  const entries = rateTableEntries(overrides["rate_table"]);
  return {
    rate_table:
      entries.length > 0
        ? entries.map((e) => `${e.room_type}: ${formatUsd(e.nightly_rate_cents)}/night`).join("; ")
        : "(no rates on file — say you'll need to check and take a message rather than guessing)",
    deposit_policy_text:
      str(depositPolicy?.["text"]) ??
      (depositPolicy?.["required"] === true
        ? "a deposit is required to hold the reservation"
        : "no deposit is currently required"),
  };
}

const MAX_MENU_CHARS = 1500;
const NO_MENU_ON_FILE =
  "no menu items are on file right now — say you'll need to check and take a message for the order";

/** Restaurant: {{menu_text}}, rendered from active `offerings` when no override string is set. */
export function renderMenuFromOfferings(rows: OfferingRow[]): string {
  if (rows.length === 0) return NO_MENU_ON_FILE;
  const parts: string[] = [];
  let length = 0;
  for (const row of rows) {
    const piece =
      row.price_cents !== null ? `${row.name} (${formatUsd(row.price_cents)})` : row.name;
    if (length + piece.length + 2 > MAX_MENU_CHARS) break;
    parts.push(piece);
    length += piece.length + 2;
  }
  return parts.length > 0 ? parts.join("; ") : NO_MENU_ON_FILE;
}

/**
 * Restaurant: {{prep_time_text}} (spoken order-ready expectation, sourced
 * from `zBaseDynamicVariableOverrides.prep_time_minutes`) and
 * {{delivery_terms_text}} (spoken delivery fee/minimum statement, sourced
 * from `zRestaurantOverrides.delivery_fee_cents`/`min_order_cents` —
 * FIX_REQUESTS.md). Both default to a safe, non-numeric fallback rather
 * than inventing a figure when unset. NOT yet referenced by
 * `restaurant.ts`'s compiled prompt — see that file's own note — kept
 * here, resolved and ready, so wiring it in later never risks the
 * literal-placeholder failure mode (GAP_REGISTER §1.3).
 */
export function resolveRestaurantSpokenTerms(
  overrides: Record<string, unknown>,
): Record<string, string> {
  const prepTimeMinutes = num(overrides["prep_time_minutes"]);
  const deliveryFeeCents = num(overrides["delivery_fee_cents"]);
  const minOrderCents = num(overrides["min_order_cents"]);

  const deliveryParts: string[] = [];
  if (deliveryFeeCents !== undefined) {
    deliveryParts.push(
      deliveryFeeCents > 0
        ? `a ${formatUsd(deliveryFeeCents)} delivery fee applies`
        : "delivery is free",
    );
  }
  if (minOrderCents !== undefined && minOrderCents > 0) {
    deliveryParts.push(`the minimum order for delivery is ${formatUsd(minOrderCents)}`);
  }

  return {
    prep_time_text:
      prepTimeMinutes !== undefined
        ? `about ${prepTimeMinutes} minutes`
        : "an amount of time we'll confirm when you order",
    delivery_terms_text:
      deliveryParts.length > 0
        ? renderList(deliveryParts)
        : "we'll confirm any delivery fee or minimum when you order",
  };
}

export async function resolveMenuText(params: {
  sql: SqlClient;
  tenantId: string;
  overrides: Record<string, unknown>;
}): Promise<string> {
  const override = str(params.overrides["menu_text"]);
  if (override) return override;
  const rows = await params.sql<OfferingRow>`
    select name, price_cents
    from public.offerings
    where tenant_id = ${params.tenantId} and active
    order by category nulls last, name
  `;
  return renderMenuFromOfferings(rows);
}

/**
 * Resolves every vertical-specific `{{token}}` for the given tenant, plus
 * the universal `cancellation_policy_text`. Scoped by vertical so an
 * unrelated tenant never pays for (or receives) another vertical's tokens.
 */
export async function resolveVerticalDynamicVariables(params: {
  sql: SqlClient;
  tenantId: string;
  vertical: string;
  overrides: Record<string, unknown>;
  logger: Logger;
}): Promise<{ cancellation_policy_text: string } & Record<string, string>> {
  const { sql, tenantId, vertical, overrides, logger } = params;
  const tokens: { cancellation_policy_text: string } & Record<string, string> = {
    cancellation_policy_text: resolveCancellationPolicyText(overrides),
  };

  switch (vertical) {
    case "legal":
      Object.assign(tokens, resolveLegalTokens(overrides));
      break;
    case "auto":
      Object.assign(tokens, resolveAutoTokens(overrides));
      break;
    case "vet":
      Object.assign(tokens, resolveVetTokens(overrides));
      break;
    case "motel":
      Object.assign(tokens, resolveMotelTokens(overrides));
      break;
    case "restaurant":
      Object.assign(tokens, resolveRestaurantSpokenTerms(overrides));
      try {
        tokens["menu_text"] = await resolveMenuText({ sql, tenantId, overrides });
      } catch (err) {
        logger.error("voice_inbound_menu_text_resolution_failed", {
          tenant_id: tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
        tokens["menu_text"] = NO_MENU_ON_FILE;
      }
      break;
    default:
      break;
  }

  return tokens;
}
