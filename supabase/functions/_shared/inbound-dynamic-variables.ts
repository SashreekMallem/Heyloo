/**
 * CALL-9 (docs/BUILD_PLAN.md): the shared pre-call lookup + dynamic-
 * variable assembly `voice-inbound/handler.ts` (Retell's real
 * `call_inbound` webhook — BACKEND_SPEC §7.1) and
 * `api-admin-run-agent-tests` (the batch-test harness) BOTH call now,
 * instead of the batch-test harness re-implementing a thinner subset of
 * the same logic. Extracted byte-for-byte from `voice-inbound/handler.ts`'s
 * pre-CALL-9 body (customer-by-phone lookup -> `caller_recent_context`,
 * hours/date context, per-vertical `{{token}}` resolution, override
 * passthrough) — no behavior change for a real call, since
 * `voice-inbound/handler.ts` now just fetches its row and calls this.
 *
 * Owner's question this closes (see docs/BUILD_NOTES.md CALL-9): "does it
 * pull data from our database before the call?" — this function IS that
 * pull, and it is now the SAME code a real Retell `call_inbound` webhook
 * runs and what `api-admin-run-agent-tests`'s new `simulate` action (and,
 * for a returning-caller scenario, its batch-test dynamic variables) both
 * exercise live — so proving it live via either path proves the other.
 *
 * Latency budget: unchanged from `voice-inbound/handler.ts`'s own p95<300ms
 * note (SYSTEM_DESIGN §5) — one extra indexed `customers` lookup (only when
 * `fromNumber` is non-null) plus `resolveVerticalDynamicVariables`'s own
 * documented one extra `offerings` read for a restaurant tenant with no
 * `menu_text` override. Never called from the voice-tools hot path
 * (`/voice/tools`) — only from `/voice-inbound` and the admin test harness,
 * neither of which shares that tighter budget.
 */

// Cross-function-folder import — same established pattern this repo already
// uses (worker-tick/handler.ts importing worker-adapter-push/handler.ts,
// job-reconciliation/handler.ts importing voice-events/handler.ts,
// api-admin-run-agent-tests/handler.ts's own pre-CALL-9 import of this exact
// module, CALL-7's own doc comment there).
import { resolveVerticalDynamicVariables } from "../voice-inbound/dynamic-variables.ts";
import { buildAgentSettingsVariables } from "./agent-settings.ts";
import {
  computeCurrentDateContext,
  computeGreetingHoursContext,
  computeUpcomingWeekdayDates,
} from "./business-hours.ts";
import type { VoiceInboundResponse } from "./schemas/voice-inbound.ts";
import type { Logger, SqlClient } from "./types.ts";

/**
 * DISCLOSE-1 (docs/BUILD_NOTES.md): the `/voice-inbound` response's
 * dynamic-variable shape plus the three returning-caller variables the
 * compiled agent now references (`_shared/compiler/template-compiler.ts`:
 * `{{caller_greeting}}` in the static opening line, `{{caller_name_on_file}}`
 * / `{{caller_phone_on_file}}` in the global returning-caller instruction).
 * Declared here (an intersection) rather than on the Zod response schema so
 * this shared builder stays the single source of the values; ALWAYS strings
 * (blank for a new caller / no caller ID), never omitted — Retell leaves an
 * unset `{{name}}` in place but treats `""` as a value (RETELL-VERIFIED,
 * docs.retellai.com/build/dynamic-variables, docs/VERIFY.md DISCLOSE-1).
 */
export type InboundDynamicVariables = VoiceInboundResponse["call_inbound"]["dynamic_variables"] & {
  caller_greeting: string;
  caller_name_on_file: string;
  caller_phone_on_file: string;
};

/** Everything `voice-inbound/handler.ts`'s own DB row (or an equivalent
 * synthetic one built by the admin test harness / `simulate` action)
 * carries — deliberately the same field set as that file's `InboundRow`,
 * so both callers can build this from their own query without translation. */
export interface InboundTenantConfig {
  tenantId: string;
  businessName: string;
  vertical: string;
  timezone: string;
  businessHours: Record<string, unknown>;
  hoursExceptions: unknown[];
  manualMode: boolean;
  languagePrimary: string;
  assistantName: string | null;
  specialInstructions: string | null;
  dynamicVariableOverrides: Record<string, unknown>;
  disclosureLine: string;
  transferNumber: string | null;
}

interface RecentCustomerRow {
  name: string | null;
  last_seen_at: string;
  lifetime_bookings: number;
}

/**
 * DISCLOSE-1: everything the pre-call customer lookup yields for the
 * compiled prompt — see `resolveCallerContext`.
 */
interface CallerContext {
  /** `{{caller_recent_context}}` — always a real sentence (CALL-9). */
  recentContext: string;
  /** `{{caller_greeting}}` — "Welcome back, Devin." for a recognized caller, `""` otherwise. */
  greeting: string;
  /** `{{caller_name_on_file}}` — the stored name for a recognized caller, `""` otherwise. */
  nameOnFile: string;
  /** `{{caller_phone_on_file}}` — the caller's own E.164 number when it matched a customer, `""` otherwise. */
  phoneOnFile: string;
}

/** DISCLOSE-1: the returning-caller greeting, per configured call language (ISO 639-1). Gender-neutral in Spanish. */
const WELCOME_BACK: Record<string, { named: (firstName: string) => string; unnamed: string }> = {
  en: { named: (firstName) => `Welcome back, ${firstName}.`, unnamed: "Welcome back." },
  es: {
    named: (firstName) => `Qué gusto saludarle de nuevo, ${firstName}.`,
    unnamed: "Qué gusto saludarle de nuevo.",
  },
};

/**
 * DISCLOSE-1: a stored `customers.name` is caller-supplied speech captured
 * on an earlier call — it is now spoken verbatim by a static line and read
 * into the prompt, so keep only characters a name plausibly has (letters in
 * any script, spaces, apostrophes, hyphens, periods), collapse whitespace
 * and cap the length. Strips `{`/`}` among everything else, so a stored
 * value can never smuggle a `{{dynamic_variable}}` into the substitution.
 */
export function sanitizeNameForSpeech(raw: string | null, maxLength = 60): string {
  if (!raw) return "";
  return raw
    .replace(/[^\p{L}\p{M} '.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
}

/**
 * G28 callback continuity — looks up `customers` by `tenant_id` +
 * `phone_e164` (indexed, single-row) and returns what the compiled prompt
 * needs about a returning caller: never PII beyond the caller's OWN name and
 * the number they are calling from (the same G6 scope `lookup_customer`
 * already returns to the model for this caller). `fromNumber` must already
 * be normalized E.164 (or `null` — no caller number to look up, the common
 * case for a placeholder/batch-test call with no `heyloo_test_caller_number`
 * set).
 *
 * CALL-9: `recentContext` is ALWAYS a real sentence, never `undefined`/
 * empty — it is wired into the compiled prompt as a live
 * `{{caller_recent_context}}` placeholder (`_shared/compiler/
 * template-compiler.ts`), and Retell only ever does literal `{{name}}`
 * substitution (RETELL-VERIFIED, docs.retellai.com/build/dynamic-variables
 * 2026-09-21, docs/VERIFY.md CALL-9).
 *
 * DISCLOSE-1 (docs/BUILD_NOTES.md): VERIFY-DEPLOY's live self-call delivered
 * `caller_recent_context = "Devin has booked with us before."` and the agent
 * still re-asked name and phone — the sentence was only referenced by the
 * start node, and nothing told later nodes what was on file. This now also
 * yields a ready-to-speak `greeting` (spoken by the static opening line) and
 * the name/number on file (referenced by the compiler's GLOBAL
 * returning-caller instruction, so every node confirms instead of re-asking).
 */
async function resolveCallerContext(
  sql: SqlClient,
  tenantId: string,
  fromNumber: string | null,
  languagePrimary: string,
): Promise<CallerContext> {
  const unknown = { greeting: "", nameOnFile: "", phoneOnFile: "" };
  if (!fromNumber) {
    return {
      ...unknown,
      recentContext:
        "No caller ID is available for this call — treat this as a first-time caller and collect their name and phone number normally.",
    };
  }
  const rows = await sql<RecentCustomerRow>`
    select name, last_seen_at, lifetime_bookings
    from public.customers
    where tenant_id = ${tenantId} and phone_e164 = ${fromNumber}
    limit 1
  `;
  const recent = rows[0];
  if (!recent) {
    return {
      ...unknown,
      recentContext:
        "This is a new caller — no prior history is on file; collect their name and phone number normally.",
    };
  }
  const nameOnFile = sanitizeNameForSpeech(recent.name);
  const firstName = nameOnFile.split(" ")[0] ?? "";
  const welcome = WELCOME_BACK[languagePrimary] ?? WELCOME_BACK["en"];
  const label = firstName || "This caller";
  return {
    recentContext:
      recent.lifetime_bookings > 0
        ? `${label} has booked with us before.`
        : `${label} has called before.`,
    greeting: welcome ? (firstName ? welcome.named(firstName) : welcome.unnamed) : "",
    nameOnFile,
    phoneOnFile: fromNumber,
  };
}

/**
 * QA-HOT (docs/BUILD_NOTES.md): `tenants.language_config.primary` stores a
 * bare ISO 639-1 short code (`AGENT_LANGUAGES` — `"en"`/`"es"`,
 * `packages/canonical-types/src/schemas/agent-language.ts`), but Retell's
 * own agent-level `language` field (governs STT locale + default TTS
 * voice, distinct from the `{{language}}` DYNAMIC VARIABLE this module
 * also sends — that one only tells the MODEL which language to speak,
 * never the speech pipeline's own locale) requires a full locale string.
 * RETELL-VERIFIED (docs.retellai.com/api-references/create-agent,
 * 2026-09-23, docs/VERIFY.md QA-HOT): the supported set has no bare
 * `es-US` — `es-419` (Latin American Spanish) is the closest match for a
 * US-based tenant's Spanish-speaking callers (vs. `es-ES`, Castilian
 * Spanish), so that's the mapping chosen here. Used by
 * `_shared/provisioning/compile-and-publish.ts`'s `createAgent` call —
 * the actual Retell-facing half of language support; this module's own
 * `language` dynamic variable (below) is the other half (what the
 * compiled prompt tells the model to speak,
 * `_shared/compiler/template-compiler.ts#LANGUAGE_INSTRUCTION`). Falls
 * back to `en-US` for any short code this map doesn't recognize —
 * never leaves the agent's `language` field unset/undefined, since an
 * omitted field defaults to `en-US` anyway (RETELL-VERIFIED) and an
 * explicit fallback here is one less place that silent Retell default has
 * to be remembered.
 */
const RETELL_LANGUAGE_BY_SHORT_CODE: Record<string, string> = {
  en: "en-US",
  es: "es-419",
};

export function resolveRetellAgentLanguage(languagePrimary: string): string {
  return RETELL_LANGUAGE_BY_SHORT_CODE[languagePrimary] ?? "en-US";
}

/**
 * DISCLOSE-2: `{{assistant_name}}` when `agent_configs.assistant_name` is
 * unset. It is spoken inside the static opening line's disclosure literal
 * ("This is {{assistant_name}}, their AI assistant"), so it must be a real
 * persona name, not a description — the DISCLOSE-1 fallback "the AI
 * assistant" made callers hear "This is the AI assistant, their AI
 * assistant". A given name reads the same in every language. Also used by
 * `_shared/provisioning/compile-and-publish.ts` for the compiled
 * `default_dynamic_variables`, and mirrored in
 * `_shared/text-agent/conversation-store.ts` and
 * `apps/web/src/lib/settings/greeting.ts`.
 */
export const DEFAULT_ASSISTANT_NAME = "Ava";

export function defaultAssistantName(_languagePrimary?: string): string {
  return DEFAULT_ASSISTANT_NAME;
}

export async function buildInboundDynamicVariables(params: {
  sql: SqlClient;
  logger: Logger;
  now: Date;
  /** Already-normalized E.164, or `null` — the caller passes `null` when
   * there is no live caller number to look up (an FAQ-only batch-test
   * scenario, a call with no caller id). Never derived from `args`. */
  fromNumber: string | null;
  config: InboundTenantConfig;
}): Promise<InboundDynamicVariables> {
  const { sql, logger, now, fromNumber, config } = params;

  const callerContext = await resolveCallerContext(
    sql,
    config.tenantId,
    fromNumber,
    config.languagePrimary,
  );

  const overrides = config.dynamicVariableOverrides ?? {};
  const greetingHoursContext = computeGreetingHoursContext(
    now,
    config.timezone,
    config.businessHours as never,
    config.hoursExceptions as never,
  );
  const currentDateContext = computeCurrentDateContext(now, config.timezone);
  const upcomingWeekdayDates = computeUpcomingWeekdayDates(now, config.timezone);

  // SETTINGS-2 (docs/BUILD_NOTES.md): every owner setting the portal saves,
  // resolved at call time as plain strings (Retell dynamic variables are
  // strings only): `special_instructions`, `faq_text`, `business_facts`,
  // `voicemail_message`, `booking_mode_text` (Manual Mode) and the call-
  // routing-aware `transfer_number` / `transfer_policy_text`. See
  // `_shared/agent-settings.ts` for the sanitizing/bounds and the routing rules.
  const settings = buildAgentSettingsVariables({
    specialInstructions: config.specialInstructions,
    overrides,
    manualMode: config.manualMode,
    transferNumber: config.transferNumber,
    vertical: config.vertical,
    timezone: config.timezone,
    businessHours: config.businessHours,
    hoursExceptions: config.hoursExceptions,
    now,
  });

  const verticalTokens = await resolveVerticalDynamicVariables({
    sql,
    tenantId: config.tenantId,
    vertical: config.vertical,
    overrides,
    logger,
  });

  const dynamicVariables: InboundDynamicVariables = {
    business_name: config.businessName,
    assistant_name: config.assistantName?.trim() || defaultAssistantName(config.languagePrimary),
    greeting_hours_context: greetingHoursContext,
    timezone: config.timezone,
    current_date: currentDateContext.date,
    current_weekday: currentDateContext.weekday,
    upcoming_weekday_dates: upcomingWeekdayDates,
    special_instructions: settings.special_instructions,
    is_manual_mode: config.manualMode,
    language: config.languagePrimary,
    disclosure_line: config.disclosureLine,
    // PUBLISH-1 (docs/BUILD_NOTES.md): ALWAYS sent now, even as an empty
    // string when `agent_configs.transfer_number` is unset — never
    // omitted. Every compiled flow now literally embeds `{{transfer_number}}`
    // (`_shared/compiler/template-compiler.ts`'s transfer-only router
    // instruction/edge AND its `TransferCallNode.transfer_destination.
    // number`), so the model needs a real, consistently-typed (always a
    // string, possibly empty) substitution to reason about — omitting the
    // key would leave a literal unresolved `{{transfer_number}}` token
    // instead (the exact anti-pattern `resolveCallerRecentContext`'s own
    // doc comment above already documents and avoids for
    // `caller_recent_context`).
    //
    // SETTINGS-2: now the call-routing-aware value (still tenant config only,
    // G6): the transfer number, the owner's after-hours number while closed,
    // or "" — see `resolveCallRouting`.
    transfer_number: settings.transfer_number,
    transfer_policy_text: settings.transfer_policy_text,
    faq_text: settings.faq_text,
    business_facts: settings.business_facts,
    voicemail_message: settings.voicemail_message,
    booking_mode_text: settings.booking_mode_text,
    ...verticalTokens,
    ...(typeof overrides["manager_name"] === "string"
      ? { manager_name: overrides["manager_name"] as string }
      : {}),
    ...(typeof overrides["manager_phone"] === "string"
      ? { manager_phone: overrides["manager_phone"] as string }
      : {}),
    ...(typeof overrides["parking_info"] === "string"
      ? { parking_info: overrides["parking_info"] as string }
      : {}),
    ...(typeof overrides["accessibility_notes"] === "string"
      ? { accessibility_notes: overrides["accessibility_notes"] as string }
      : {}),
    ...(Array.isArray(overrides["accepted_payment_types"])
      ? { accepted_payment_types: overrides["accepted_payment_types"] as string[] }
      : {}),
    caller_recent_context: callerContext.recentContext,
    // DISCLOSE-1: always strings (blank for a new caller / no caller ID) —
    // see `InboundDynamicVariables`' own doc comment.
    caller_greeting: callerContext.greeting,
    caller_name_on_file: callerContext.nameOnFile,
    caller_phone_on_file: callerContext.phoneOnFile,
  };

  return dynamicVariables;
}
