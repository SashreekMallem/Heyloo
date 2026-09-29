/**
 * INTAKE-Q-1 (docs/BUILD_NOTES.md): owner-defined custom intake questions.
 *
 * The business owner can add up to `CUSTOM_QUESTIONS_MAX` extra questions the
 * AI asks every caller who books or leaves a message, on top of the vertical's
 * built-in intake (`vertical-intake.ts`). Stored at
 * `agent_configs.dynamic_variable_overrides.custom_questions` (the same place
 * as the FAQ, so the pre-call `voice-inbound` read already has it, RLS and the
 * owner column grant already cover it, and no republish is needed for an edit —
 * only the compiled wording that explains the list needs a publish, once, via
 * `AGENT_COMPILER_VERSION`). The database also enforces the shape and the cap
 * (migration 20260930230000, `custom_questions_valid`).
 *
 * Stored shape (one array element per question):
 *   { id, label, hint?, required, applies_to: "booking"|"message"|"both",
 *     position, active }
 *
 * Three consumers:
 *  1. `agent-settings.ts` -> the `{{custom_questions_text}}` dynamic variable
 *     (voice, resolved per call).
 *  2. `voice-tools/handler.ts` -> `applyCustomAnswers`: server-side enforcement
 *     on `create_booking` / `take_message` (required questions unanswered ->
 *     the same model-safe "ask the caller ..." envelope the built-in fields
 *     use) and normalization of the answers that get stored.
 *  3. The owner alert templates / portal, which read the stored
 *     `custom_answers` (`[{question_id, question, answer}]`).
 *
 * PROMPT-INJECTION POSTURE (CLAUDE.md Rule 2): the owner's question text is
 * DATA that reaches the model twice (the per-call variable and the tool error
 * message), so it goes through the same `sanitizeOwnerText` the FAQ and special
 * instructions use (control/invisible characters, braces, tag and fence markers,
 * known instruction-override phrases). A question whose wording trips the
 * override filter is DROPPED here (never asked, never required) rather than
 * asked in mangled form. Caller answers are caller speech: stored as data,
 * length-capped and stripped of control characters, never re-injected into a
 * prompt.
 *
 * Pure and dependency-light (sanitize via agent-settings, no I/O) so it runs
 * unchanged under Deno and Node/Vitest and adds nothing to the hot path beyond
 * one array walk.
 */

import { sanitizeOwnerText } from "./agent-settings.ts";
import type { RequiredIntakeField } from "./vertical-intake.ts";

// ---------------------------------------------------------------------
// bounds (mirrored for the portal in apps/web/src/lib/settings/custom-questions.ts)
// ---------------------------------------------------------------------

export const CUSTOM_QUESTIONS_MAX = 10;
export const CUSTOM_QUESTION_LABEL_MAX_CHARS = 200;
export const CUSTOM_QUESTION_HINT_MAX_CHARS = 100;
export const CUSTOM_ANSWER_MAX_CHARS = 500;
export const CUSTOM_QUESTION_APPLIES_TO = ["booking", "message", "both"] as const;
export type CustomQuestionAppliesTo = (typeof CUSTOM_QUESTION_APPLIES_TO)[number];

export const NO_CUSTOM_QUESTIONS_TEXT = "(no custom questions)";

/**
 * The one answer the model may give for a REQUIRED question the caller
 * refuses (after asking twice, per the compiled procedure): without it a
 * caller who won't say, e.g., a gate code could never book or even leave a
 * message. The server can't tell a real refusal from a lazy model either way
 * (it can't hear the call), so this doesn't weaken enforcement beyond what a
 * fabricated answer already does; it gives the honest path a name and shows
 * the owner that the caller declined. Stored as `CUSTOM_ANSWER_DECLINED_TEXT`.
 * On an OPTIONAL question it is treated as no answer (nothing stored).
 */
export const CUSTOM_ANSWER_DECLINED_TOKEN = "declined";
export const CUSTOM_ANSWER_DECLINED_TEXT = "Declined to answer";

const ID_PATTERN = /^[a-z0-9_-]{1,32}$/;
const REDACTION_MARKER = "[redacted]";

export type CustomQuestionTool = "create_booking" | "take_message";

export interface CustomQuestion {
  id: string;
  /** Sanitized, quote-free question text, asked verbatim. */
  label: string;
  /** Sanitized answer-format hint (`""` when none). */
  hint: string;
  required: boolean;
  appliesTo: CustomQuestionAppliesTo;
}

export interface CustomAnswer {
  question_id: string;
  question: string;
  answer: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Owner text -> a one-line, quote-free, injection-filtered string; `null` when the wording is unusable. */
function cleanQuestionText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = sanitizeOwnerText(raw.replace(/["“”]/g, "'"), maxLength);
  if (cleaned.includes(REDACTION_MARKER)) return null;
  return cleaned;
}

/**
 * `overrides.custom_questions` -> the questions the agent may ask right now:
 * active, well-formed, sanitized, ordered by `position` (array order breaks
 * ties), at most `CUSTOM_QUESTIONS_MAX`, unique ids. Never throws; anything
 * malformed is skipped so one bad element can't disable the rest.
 */
export function resolveCustomQuestions(overrides: unknown): CustomQuestion[] {
  const raw = record(overrides)?.["custom_questions"];
  if (!Array.isArray(raw)) return [];
  const candidates: Array<{ position: number; index: number; question: CustomQuestion }> = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    const item = record(entry);
    if (!item || item["active"] === false) return;
    const id = typeof item["id"] === "string" ? item["id"] : "";
    if (!ID_PATTERN.test(id) || seen.has(id)) return;
    const label = cleanQuestionText(item["label"], CUSTOM_QUESTION_LABEL_MAX_CHARS);
    if (!label) return;
    const hint = cleanQuestionText(item["hint"], CUSTOM_QUESTION_HINT_MAX_CHARS) ?? "";
    const appliesTo = CUSTOM_QUESTION_APPLIES_TO.find((v) => v === item["applies_to"]) ?? "both";
    seen.add(id);
    const position =
      typeof item["position"] === "number" && Number.isFinite(item["position"])
        ? item["position"]
        : index;
    candidates.push({
      position,
      index,
      question: { id, label, hint, required: item["required"] === true, appliesTo },
    });
  });
  candidates.sort((a, b) => a.position - b.position || a.index - b.index);
  return candidates.slice(0, CUSTOM_QUESTIONS_MAX).map((c) => c.question);
}

/** The questions that apply to one write tool (`create_booking` -> booking|both, `take_message` -> message|both). */
export function questionsForTool(
  questions: CustomQuestion[],
  tool: CustomQuestionTool,
): CustomQuestion[] {
  const kind = tool === "create_booking" ? "booking" : "message";
  return questions.filter((q) => q.appliesTo === "both" || q.appliesTo === kind);
}

const APPLIES_TO_TEXT: Record<CustomQuestionAppliesTo, string> = {
  booking: "bookings only",
  message: "messages only",
  both: "bookings and messages",
};

/**
 * `{{custom_questions_text}}`: one numbered line per question, in the order the
 * agent should ask them. Contains no braces and no double quotes other than the
 * ones this function adds around the question text. `NO_CUSTOM_QUESTIONS_TEXT`
 * when there are none (the compiled prompt tells the agent to skip the step).
 */
export function buildCustomQuestionsText(questions: CustomQuestion[]): string {
  if (questions.length === 0) return NO_CUSTOM_QUESTIONS_TEXT;
  return questions
    .map(
      (q, i) =>
        `${i + 1}. [id ${q.id}] "${q.label}"` +
        `${q.hint ? ` (answer format: ${q.hint})` : ""}` +
        ` — asked for ${APPLIES_TO_TEXT[q.appliesTo]} — ${q.required ? "REQUIRED" : "optional"}`,
    )
    .join("\n");
}

/** Convenience: overrides -> variable text. */
export function resolveCustomQuestionsText(overrides: unknown): string {
  return buildCustomQuestionsText(resolveCustomQuestions(overrides));
}

// ---------------------------------------------------------------------
// answers
// ---------------------------------------------------------------------

// Control characters (C0 except tab/newline handling below, DEL, C1), the Unicode line/paragraph
// separators, and bidi/zero-width characters that can hide or reorder text.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally strips control characters from caller speech
const ANSWER_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/g;
const ANSWER_INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/** A caller's answer: single-line, control/invisible characters stripped, capped. Stored as data only. */
export function cleanCustomAnswer(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const text = raw
    .replace(ANSWER_CONTROL_CHARS, " ")
    .replace(ANSWER_INVISIBLE_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > CUSTOM_ANSWER_MAX_CHARS
    ? `${text.slice(0, CUSTOM_ANSWER_MAX_CHARS - 1).trimEnd()}…`
    : text;
}

export interface CustomAnswersOutcome {
  /** Args with `structured_payload.custom_answers` replaced by the validated list (or removed when empty). */
  args: Record<string, unknown>;
  /** Required questions with no usable answer, as `RequiredIntakeField`s for `missingFieldsEnvelope`. */
  missing: RequiredIntakeField[];
}

/**
 * Validates the model's `structured_payload.custom_answers` against the
 * tenant's CURRENT questions for this tool. Answers for unknown/inactive/
 * not-applicable ids are dropped (the model can never store arbitrary keyed
 * data through this path); the stored `question` text is always the owner's
 * (sanitized) wording, never what the model claims it asked; duplicate ids keep
 * the first non-blank answer. Required questions still unanswered are returned
 * as `missing`, phrased so the model asks the owner's exact question.
 */
export function applyCustomAnswers(
  tool: CustomQuestionTool,
  allQuestions: CustomQuestion[],
  args: Record<string, unknown>,
): CustomAnswersOutcome {
  const applicable = questionsForTool(allQuestions, tool);
  const payload = record(args["structured_payload"]);
  const rawAnswers = payload?.["custom_answers"];

  const byId = new Map<string, string>();
  if (Array.isArray(rawAnswers)) {
    for (const entry of rawAnswers) {
      const item = record(entry);
      // Ids are lowercase by construction; tolerate a model that echoes one back with stray case/space.
      const id =
        typeof item?.["question_id"] === "string" ? item["question_id"].trim().toLowerCase() : "";
      const answer = cleanCustomAnswer(item?.["answer"]);
      if (id && answer && !byId.has(id)) byId.set(id, answer);
    }
  }

  const answers: CustomAnswer[] = [];
  const missing: RequiredIntakeField[] = [];
  for (const question of applicable) {
    let answer = byId.get(question.id);
    if (answer && answer.toLowerCase().replace(/[.!\s]+$/, "") === CUSTOM_ANSWER_DECLINED_TOKEN) {
      // The caller refused: a required question records that (so the booking or message is not
      // lost); an optional one just stays unanswered.
      answer = question.required ? CUSTOM_ANSWER_DECLINED_TEXT : undefined;
    }
    if (answer) {
      answers.push({ question_id: question.id, question: question.label, answer });
    } else if (question.required) {
      missing.push({
        path: `structured_payload.custom_answers.${question.id}`,
        askFor: `the answer to this question, in the owner's words (translated only if the call is in another language): "${question.label}" (record it under question_id ${question.id})`,
      });
    }
  }

  if (!payload && answers.length === 0) return { args, missing };
  const nextPayload: Record<string, unknown> = { ...(payload ?? {}) };
  if (answers.length > 0) nextPayload["custom_answers"] = answers;
  else delete nextPayload["custom_answers"];
  return { args: { ...args, structured_payload: nextPayload }, missing };
}

/**
 * Owner-alert payload fragment: `{custom_answers: [{question, answer}]}` from a
 * stored `structured_payload` (empty object when none), so the alert templates
 * (`templates.ts`) need no knowledge of the storage shape.
 */
export function alertCustomAnswers(
  payload: unknown,
): { custom_answers: Array<{ question: string; answer: string }> } | Record<string, never> {
  const answers = readStoredCustomAnswers(payload);
  return answers.length > 0
    ? { custom_answers: answers.map(({ question, answer }) => ({ question, answer })) }
    : {};
}

/** `structured_payload.custom_answers` as stored -> validated entries for display/alerts (never throws). */
export function readStoredCustomAnswers(payload: unknown): CustomAnswer[] {
  const raw = record(payload)?.["custom_answers"];
  if (!Array.isArray(raw)) return [];
  const out: CustomAnswer[] = [];
  for (const entry of raw) {
    const item = record(entry);
    const question = cleanCustomAnswer(item?.["question"]);
    const answer = cleanCustomAnswer(item?.["answer"]);
    const id = typeof item?.["question_id"] === "string" ? item["question_id"] : "";
    if (question && answer) out.push({ question_id: id, question, answer });
  }
  return out;
}
