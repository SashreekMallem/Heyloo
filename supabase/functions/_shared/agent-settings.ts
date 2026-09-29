/**
 * SETTINGS-2 (docs/BUILD_NOTES.md): turns every owner-editable AI setting the
 * portal saves (`agent_configs.special_instructions` +
 * `dynamic_variable_overrides` + `tenants.manual_mode`) into the plain-string
 * dynamic variables the compiled agent references — resolved AT CALL TIME by
 * `inbound-dynamic-variables.ts` (voice) and `text-agent/engine.ts` (text), so
 * an edit takes effect on the next call/text with no republish.
 *
 * Retell dynamic variables are strings only (RETELL-VERIFIED,
 * docs.retellai.com/build/dynamic-variables, 2026-09-29: "Send values ... as
 * strings"; a variable with no value is left as a raw `{{name}}`, "an empty
 * string counts as a value" — so every variable here is ALWAYS a string).
 *
 * PROMPT-INJECTION POSTURE (CLAUDE.md Rule 2; the owner's text is data):
 *  - every owner string is passed through `sanitizeOwnerText`: control
 *    characters, `{`/`}` (a value can never smuggle a `{{variable}}`), tag-
 *    like `<system>` markup and known instruction-override phrases
 *    (`sanitizeScrapedContent`, G21) are removed, whitespace is collapsed and
 *    the length is capped;
 *  - lists are bounded (FAQ: entries and characters; payment types; etc.);
 *  - the compiled prompt fences everything below in owner-data markers and
 *    states the precedence (`OWNER_INFO_INSTRUCTIONS` in
 *    `compiler/template-compiler.ts`). Nothing here can change the opening
 *    disclosure (a static line), the tool set, or a transfer DESTINATION —
 *    destinations only ever come from `agent_configs.transfer_number` and
 *    `overrides.call_routing.after_hours_phone`, both owner-account config
 *    validated to E.164 (G6), never from caller or model input.
 *
 * Pure and dependency-light (business-hours, phone, sanitize only) so it runs
 * unchanged under Deno and Node/Vitest. No I/O: the hot path stays lean.
 */

import { type HoursException, isOpenAt, type WeeklyBusinessHours } from "./business-hours.ts";
import { normalizeE164 } from "./phone.ts";
import { sanitizeScrapedContent } from "./sanitize.ts";

// ---------------------------------------------------------------------
// bounds (mirrored for the portal in apps/web/src/lib/settings/faq-budget.ts)
// ---------------------------------------------------------------------

/** FAQ entries the agent reads. The portal accepts more (50) but the agent only sees what fits. */
export const FAQ_MAX_ITEMS = 25;
/** Total characters of formatted FAQ text sent per call (Q:/A: lines included). */
export const FAQ_MAX_CHARS = 4000;
export const FAQ_QUESTION_MAX_CHARS = 200;
export const FAQ_ANSWER_MAX_CHARS = 700;
const SPECIAL_INSTRUCTIONS_MAX_CHARS = 2000;
const VOICEMAIL_MAX_CHARS = 600;
const FACT_MAX_CHARS = 600;
const NAME_MAX_CHARS = 80;
const LIST_ITEM_MAX_CHARS = 60;
const LIST_MAX_ITEMS = 25;
const SIGN_OFF_MAX_CHARS = 120;

export const NO_FAQ_TEXT = "(no FAQ entries have been added)";
export const NO_FACTS_TEXT = "(nothing extra on file)";

// ---------------------------------------------------------------------
// sanitizing
// ---------------------------------------------------------------------

// Control characters other than tab/newline (C0, DEL, C1) and the Unicode
// line/paragraph separators, bidi controls and zero-width characters that can
// hide or reorder text.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally strips control characters from owner text
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/g;
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;
const TAG_LIKE = /<\s*\/?\s*[a-zA-Z_][\w\s="'.:-]*>/g;
/** The owner-data fence markers the compiled prompt uses — never allowed inside a value. */
const FENCE_LIKE = /\[\[\s*(?:BEGIN|END)[^\]]*\]\]/gi;

/**
 * Cleans one owner-supplied string for use inside a prompt or spoken text.
 * `multiline` keeps single line breaks (special instructions); everything
 * else is collapsed to one line. Never throws; non-strings become `""`.
 */
export function sanitizeOwnerText(
  raw: unknown,
  maxLength: number,
  options: { multiline?: boolean } = {},
): string {
  if (typeof raw !== "string") return "";
  let text = raw
    .replace(CONTROL_CHARS, " ")
    .replace(INVISIBLE_CHARS, "")
    .replace(/[{}]/g, "")
    .replace(FENCE_LIKE, " ")
    .replace(TAG_LIKE, " ");
  text = sanitizeScrapedContent(text);
  text = options.multiline
    ? text
        .split(/\r?\n/)
        .map((line) => line.replace(/[ \t]+/g, " ").trim())
        .filter((line, index, lines) => line.length > 0 || (index > 0 && lines[index - 1] !== ""))
        .join("\n")
        .trim()
    : text.replace(/\s+/g, " ").trim();
  if (text.length > maxLength) text = `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  return text;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function cleanList(value: unknown, maxItems = LIST_MAX_ITEMS): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const item = sanitizeOwnerText(entry, LIST_ITEM_MAX_CHARS);
    if (item.length > 0 && !out.includes(item)) out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

function listText(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------

/**
 * `overrides.faq_items` -> a bounded `Q:`/`A:` block. Entries missing either
 * half are skipped; at most `FAQ_MAX_ITEMS` entries and `FAQ_MAX_CHARS`
 * characters are used (earlier entries win — the portal lists them in the
 * owner's order, so the ones they put first are the ones kept).
 */
export function resolveFaqText(overrides: Record<string, unknown>): string {
  const raw = overrides["faq_items"];
  if (!Array.isArray(raw)) return NO_FAQ_TEXT;
  const blocks: string[] = [];
  let length = 0;
  for (const entry of raw) {
    if (blocks.length >= FAQ_MAX_ITEMS) break;
    const item = record(entry);
    const question = sanitizeOwnerText(item?.["question"], FAQ_QUESTION_MAX_CHARS);
    const answer = sanitizeOwnerText(item?.["answer"], FAQ_ANSWER_MAX_CHARS);
    if (!question || !answer) continue;
    const block = `Q: ${question}\nA: ${answer}`;
    const next = length + block.length + (blocks.length > 0 ? 2 : 0);
    if (next > FAQ_MAX_CHARS) break;
    blocks.push(block);
    length = next;
  }
  return blocks.length > 0 ? blocks.join("\n\n") : NO_FAQ_TEXT;
}

// ---------------------------------------------------------------------
// business facts (manager, parking, accessibility, payments, insurance, prep time)
// ---------------------------------------------------------------------

/** Tenant-local "h:mm AM/PM" — the clock face callers hear. */
export function formatLocalClock(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace(/\u202F/g, " ");
}

/**
 * Restaurant: the prep-time fact, with the ready-around time precomputed at
 * call time so the model never does clock arithmetic (same reasoning as
 * `computeUpcomingWeekdayDates`). Empty when no prep time is set.
 */
export function resolvePrepTimeFact(
  overrides: Record<string, unknown>,
  now: Date,
  timeZone: string,
): string {
  const minutes = overrides["prep_time_minutes"];
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return "";
  const rounded = Math.min(Math.round(minutes), 1440);
  const readyAt = new Date(now.getTime() + rounded * 60_000);
  return (
    `Typical order prep time: about ${rounded} minutes. When the caller asks when an order will be ready, ` +
    `quote it as "around" a time, never an exact minute: it is ${formatLocalClock(now, timeZone)} now, so an ` +
    `order placed right now would be ready around ${formatLocalClock(readyAt, timeZone)}; if the call has ` +
    "run several minutes since you started, add that time. Never promise a pickup time earlier than " +
    "this or guarantee it."
  );
}

/**
 * The compact "facts the owner gave us" block: one labeled line per set
 * field, blank fields omitted. `insurances_accepted` (dental) and
 * `prep_time_minutes` (restaurant) are included only for their vertical —
 * another vertical's stray key never reaches the prompt.
 */
export function resolveBusinessFacts(params: {
  overrides: Record<string, unknown>;
  vertical: string;
  now: Date;
  timezone: string;
}): string {
  const { overrides, vertical, now, timezone } = params;
  const lines: string[] = [];

  const managerName = sanitizeOwnerText(overrides["manager_name"], NAME_MAX_CHARS);
  const managerPhone = normalizeE164(
    typeof overrides["manager_phone"] === "string" ? overrides["manager_phone"] : null,
  );
  if (managerName || managerPhone) {
    lines.push(
      `Manager: ${managerName || "(name not given)"}${managerPhone ? `, phone ${managerPhone}` : ""}. ` +
        "Share the manager's name or phone only when the caller asks for the manager or how to reach them; " +
        "this is NOT a transfer number — never dial it, and only transfer with the transfer tool.",
    );
  }
  const parking = sanitizeOwnerText(overrides["parking_info"], FACT_MAX_CHARS);
  if (parking) lines.push(`Parking: ${parking}`);
  const accessibility = sanitizeOwnerText(overrides["accessibility_notes"], FACT_MAX_CHARS);
  if (accessibility) lines.push(`Accessibility: ${accessibility}`);
  const payments = cleanList(overrides["accepted_payment_types"]);
  if (payments.length > 0) lines.push(`Payment types accepted: ${listText(payments)}.`);

  if (vertical === "dental") {
    const insurances = cleanList(overrides["insurances_accepted"], 40);
    if (insurances.length > 0) {
      lines.push(
        `Insurances accepted: ${listText(insurances)}. Only say a plan is accepted if it is in this list; ` +
          "if it is not listed, say you can't confirm it and offer to take a message for the office. " +
          "Never promise coverage, benefits, copays or what a plan will pay.",
      );
    }
  }
  if (vertical === "restaurant") {
    const prep = resolvePrepTimeFact(overrides, now, timezone);
    if (prep) lines.push(prep);
  }
  return lines.length > 0 ? lines.join("\n") : NO_FACTS_TEXT;
}

// ---------------------------------------------------------------------
// call routing
// ---------------------------------------------------------------------

export interface CallRoutingResolution {
  /** The E.164 number `{{transfer_number}}` resolves to for THIS call right now, or `""` (no live transfer). */
  transferNumber: string;
  /** `{{transfer_policy_text}}` — what the model is told about transfers on this call. */
  policyText: string;
  /** Whether the business is open at `now` (tenant-local hours). */
  open: boolean;
}

const POLICY_AVAILABLE =
  "A live transfer to a member of the team is available right now: offer it when the caller asks for a person or their situation needs one.";
const POLICY_URGENT_ADDENDUM =
  " If the caller describes something urgent (an emergency, a safety issue, or a situation that cannot wait), transfer them right away without further questions.";
const POLICY_AFTER_HOURS_LINE =
  "The business is closed right now, so a live transfer goes to the owner's after-hours line: offer it when the caller asks for a person or their situation needs one.";
const POLICY_CLOSED_URGENT_ONLY =
  "The business is closed right now. A live transfer is available ONLY when the caller describes something urgent (an emergency, a safety issue, or a situation that cannot wait until the business reopens) — then transfer them right away. For anything else do not offer or attempt a transfer: say the team is closed and take a message instead.";
const POLICY_CLOSED_NO_TRANSFER =
  "The business is closed right now and live transfers are switched off outside business hours. Do not offer or attempt a transfer: say the team is closed, share when they reopen if you know it, and take a message instead.";
const POLICY_NO_NUMBER =
  "No live transfer number is set. Do not offer or attempt a transfer: take a message instead.";

/**
 * `overrides.call_routing` (`{transfer_window, transfer_urgent,
 * after_hours_phone}`, written by the portal's "When to transfer" card) +
 * `agent_configs.transfer_number` + tenant hours -> the transfer number this
 * call may use and the sentence that tells the model why.
 *
 *  open (or no rule)      -> the transfer number.
 *  closed, after-hours no -> the after-hours number, if one is set (it exists
 *                            precisely for when the business is closed).
 *  closed, "any time"     -> the transfer number.
 *  closed, "business hours only":
 *     urgent transfers on -> the transfer number, told to use it ONLY for an urgent call;
 *     otherwise           -> no live transfer (take a message).
 *
 * Both numbers are owner-account config validated to E.164 by the portal;
 * they are re-normalized here so nothing non-E.164 ever reaches a transfer
 * node (Rule 2), and neither can come from caller or model input (G6).
 * `transfer_urgent` alone (open hours, "any time") just adds the "transfer
 * urgent calls right away" sentence.
 */
export function resolveCallRouting(params: {
  overrides: Record<string, unknown>;
  transferNumber: string | null;
  now: Date;
  timezone: string;
  businessHours: unknown;
  hoursExceptions: unknown;
}): CallRoutingResolution {
  const { overrides, now, timezone } = params;
  const routing = record(overrides["call_routing"]);
  const businessOnly = routing?.["transfer_window"] === "business_hours";
  const urgent = routing?.["transfer_urgent"] === true;
  const afterHours = normalizeE164(
    typeof routing?.["after_hours_phone"] === "string" ? routing["after_hours_phone"] : null,
  );
  const main = normalizeE164(params.transferNumber);

  let open = true;
  try {
    open = isOpenAt(
      now,
      timezone,
      (record(params.businessHours) ?? {}) as WeeklyBusinessHours,
      Array.isArray(params.hoursExceptions) ? (params.hoursExceptions as HoursException[]) : [],
    );
  } catch {
    // A malformed hours blob or time zone must never break a call: assume open (the pre-SETTINGS-2 behavior).
    open = true;
  }

  const available = (number: string, policy: string) => ({
    transferNumber: number,
    policyText: policy,
    open,
  });
  const none = (policy: string) => ({ transferNumber: "", policyText: policy, open });

  if (open) {
    return main
      ? available(main, urgent ? POLICY_AVAILABLE + POLICY_URGENT_ADDENDUM : POLICY_AVAILABLE)
      : none(POLICY_NO_NUMBER);
  }
  if (afterHours) return available(afterHours, POLICY_AFTER_HOURS_LINE);
  if (!main) return none(POLICY_NO_NUMBER);
  if (!businessOnly) {
    return available(main, urgent ? POLICY_AVAILABLE + POLICY_URGENT_ADDENDUM : POLICY_AVAILABLE);
  }
  return urgent ? available(main, POLICY_CLOSED_URGENT_ONLY) : none(POLICY_CLOSED_NO_TRANSFER);
}

// ---------------------------------------------------------------------
// manual mode
// ---------------------------------------------------------------------

export const BOOKING_MODE_NORMAL =
  "Normal — you can book, reschedule and cancel appointments as usual.";
export const BOOKING_MODE_MANUAL =
  "MANUAL MODE IS ON: the owner has paused automatic booking. Do NOT book, reschedule or cancel anything, " +
  "and do not call create_booking or any other tool that creates or changes a booking or reservation. " +
  "Answer the caller's questions as usual; if they want an appointment, reservation or a change, collect " +
  "their name, phone number and what they need and record it with take_message, then tell them someone from " +
  "the team will confirm with them personally. Never tell them they are booked or that anything is confirmed.";

export function resolveBookingModeText(manualMode: boolean): string {
  return manualMode ? BOOKING_MODE_MANUAL : BOOKING_MODE_NORMAL;
}

// ---------------------------------------------------------------------
// everything, for one call
// ---------------------------------------------------------------------

export interface AgentSettingsVariables extends Record<string, string> {
  /** Owner's free-text guidance, sanitized; `""` when none. */
  special_instructions: string;
  faq_text: string;
  business_facts: string;
  voicemail_message: string;
  transfer_number: string;
  transfer_policy_text: string;
  booking_mode_text: string;
}

export interface AgentSettingsInput {
  specialInstructions: string | null;
  overrides: Record<string, unknown>;
  manualMode: boolean;
  transferNumber: string | null;
  vertical: string;
  timezone: string;
  businessHours: unknown;
  hoursExceptions: unknown;
  now: Date;
}

/** The SETTINGS-2 dynamic variables for one call/text (always all strings). */
export function buildAgentSettingsVariables(input: AgentSettingsInput): AgentSettingsVariables {
  const routing = resolveCallRouting({
    overrides: input.overrides,
    transferNumber: input.transferNumber,
    now: input.now,
    timezone: input.timezone,
    businessHours: input.businessHours,
    hoursExceptions: input.hoursExceptions,
  });
  return {
    special_instructions: sanitizeOwnerText(
      input.specialInstructions,
      SPECIAL_INSTRUCTIONS_MAX_CHARS,
      { multiline: true },
    ),
    faq_text: resolveFaqText(input.overrides),
    business_facts: resolveBusinessFacts({
      overrides: input.overrides,
      vertical: input.vertical,
      now: input.now,
      timezone: input.timezone,
    }),
    voicemail_message: sanitizeOwnerText(input.overrides["voicemail_message"], VOICEMAIL_MAX_CHARS),
    transfer_number: routing.transferNumber,
    transfer_policy_text: routing.policyText,
    booking_mode_text: resolveBookingModeText(input.manualMode),
  };
}

// ---------------------------------------------------------------------
// text agent persona
// ---------------------------------------------------------------------

export const TEXT_TONES = ["friendly", "professional", "concise"] as const;
export type TextTone = (typeof TEXT_TONES)[number];

export interface TextPersona {
  tone: TextTone;
  /** Sanitized closing line, `""` when none. */
  signOff: string;
}

/** `tenants.text_agent_persona` (`{tone, signOff}`, written by the portal) -> a safe persona. Unknown tone -> friendly. */
export function resolveTextPersona(raw: unknown): TextPersona {
  const persona = record(raw);
  const tone = TEXT_TONES.find((t) => t === persona?.["tone"]) ?? "friendly";
  return { tone, signOff: sanitizeOwnerText(persona?.["signOff"], SIGN_OFF_MAX_CHARS) };
}
