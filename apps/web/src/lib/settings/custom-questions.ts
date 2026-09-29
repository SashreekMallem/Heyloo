/**
 * INTAKE-Q-1 (docs/BUILD_NOTES.md): the portal side of the owner's custom
 * intake questions. The AI reads them at call time from
 * `agent_configs.dynamic_variable_overrides.custom_questions`
 * (`supabase/functions/_shared/custom-questions.ts`, sanitized and bounded);
 * the database enforces the shape (migration 20260930230000). The constants
 * here mirror that Deno module's, and the wording check mirrors its sanitizer,
 * so an owner is told at save time about a question the AI would refuse to
 * ask (instead of it being silently dropped on calls). `custom-questions.test.ts`
 * reads the Deno sources and fails on drift.
 */

export const CUSTOM_QUESTIONS_MAX = 10;
export const CUSTOM_QUESTION_LABEL_MAX_CHARS = 200;
export const CUSTOM_QUESTION_HINT_MAX_CHARS = 100;
export const CUSTOM_QUESTION_APPLIES_TO = ["booking", "message", "both"] as const;
export type CustomQuestionAppliesTo = (typeof CUSTOM_QUESTION_APPLIES_TO)[number];

export const CUSTOM_QUESTION_APPLIES_TO_LABEL: Record<CustomQuestionAppliesTo, string> = {
  booking: "Bookings",
  message: "Messages",
  both: "Bookings and messages",
};

/** Same shape the AI and the database read. `position` is the array index at save time. */
export interface CustomQuestion {
  id: string;
  label: string;
  hint?: string;
  required: boolean;
  applies_to: CustomQuestionAppliesTo;
  position: number;
  active: boolean;
}

export const CUSTOM_QUESTION_ID_PATTERN = /^[a-z0-9_-]{1,32}$/;

/** A fresh, opaque id: `q_` + 8 lowercase hex characters. */
export function newCustomQuestionId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `q_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ---------------------------------------------------------------------
// wording check (mirror of the runtime sanitizer's rejections)
// ---------------------------------------------------------------------

/** Mirrors `INSTRUCTION_OVERRIDE_PATTERNS` in `supabase/functions/_shared/sanitize.ts` (a test compares the sources). */
export const INSTRUCTION_OVERRIDE_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+instructions?/i,
  /disregard\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+instructions?/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /forget\s+(everything|all)\s+(you\s+)?(know|were\s+told)/i,
  /system\s*:\s*/i,
  /assistant\s*:\s*/i,
  /\[?\s*new\s+instructions?\s*\]?\s*:/i,
  /act\s+as\s+(if\s+you\s+are\s+|a\s+|an\s+)/i,
  /pretend\s+(to\s+be|you\s+are)/i,
  /<\s*\/?\s*system\s*>/i,
];

const TAG_LIKE = /<\s*\/?\s*[a-zA-Z_][\w\s="'.:-]*>/;
const FENCE_LIKE = /\[\[\s*(?:BEGIN|END)[^\]]*\]\]/i;

/**
 * Why the AI would refuse to ask this text, or `null` when it is fine. The
 * portal turns this into an inline error; the runtime independently drops any
 * question that trips the same filters (a direct API write can't get one asked).
 */
export function questionWordingProblem(text: string): string | null {
  if (/[{}]/.test(text)) return "Remove the curly braces { } — they can't be used in a question.";
  if (TAG_LIKE.test(text) || FENCE_LIKE.test(text)) {
    return "Remove the <tags> or [[markers]] — write the question as plain words.";
  }
  if (INSTRUCTION_OVERRIDE_PATTERNS.some((pattern) => pattern.test(text))) {
    return "Write this as a question for the caller, not as an instruction to the AI (it can't contain phrases like “ignore previous instructions” or “system:”).";
  }
  return null;
}

// ---------------------------------------------------------------------
// what the AI already asks (read-only in the portal)
// ---------------------------------------------------------------------

export interface BuiltInQuestion {
  /** Argument paths the server requires (`vertical-intake.ts`); a test keeps these equal to that file. */
  paths: string[];
  label: string;
}

export interface BuiltInQuestions {
  booking: BuiltInQuestion[];
  message: BuiltInQuestion[];
}

const NAME: BuiltInQuestion = { paths: ["customer.name"], label: "Your caller's full name" };
const PHONE: BuiltInQuestion = {
  paths: ["customer.phone"],
  label: "A callback phone number (confirmed from caller ID when available)",
};
const WHEN: BuiltInQuestion = {
  paths: ["start", "end"],
  label: "The appointment date and time they want",
};
const CORE_BOOKING = [NAME, PHONE, WHEN];

const MESSAGE_CORE: BuiltInQuestion[] = [
  { paths: ["caller_name"], label: "Your caller's full name" },
  { paths: ["caller_phone"], label: "A callback phone number" },
  { paths: ["message_text"], label: "What the call is about" },
];

function sp(key: string, label: string): BuiltInQuestion {
  return { paths: [`structured_payload.${key}`], label };
}

export const BUILT_IN_QUESTIONS: Record<string, BuiltInQuestions> = {
  auto: {
    booking: [
      ...CORE_BOOKING,
      sp("vehicle_year", "The vehicle's model year"),
      sp("vehicle_make", "The vehicle's make"),
      sp("vehicle_model", "The vehicle's model"),
      sp("symptom_category", "What service the vehicle needs"),
    ],
    message: MESSAGE_CORE,
  },
  vet: {
    booking: [
      ...CORE_BOOKING,
      sp("pet_name", "The pet's name"),
      sp("species", "The pet's species"),
      sp("visit_reason", "The reason for the visit"),
    ],
    message: MESSAGE_CORE,
  },
  legal: {
    booking: [],
    message: [
      ...MESSAGE_CORE,
      sp("matter_type", "The type of legal matter"),
      sp("opposing_party", "The opposing party's name (for the conflict check)"),
      sp("urgency", "Whether anything is time-sensitive"),
    ],
  },
  dental: {
    booking: [
      ...CORE_BOOKING,
      sp("new_or_existing", "Whether they're a new or existing patient"),
      sp("reason_for_visit", "The reason for the visit"),
    ],
    message: MESSAGE_CORE,
  },
  real_estate: {
    booking: [
      ...CORE_BOOKING,
      sp("buyer_or_seller", "Whether they're buying or selling"),
      sp("area", "The property or area they're interested in"),
      sp("timeline", "Their timeline"),
    ],
    message: [
      ...MESSAGE_CORE,
      sp("buyer_or_seller", "Whether they're buying or selling"),
      sp("area", "The property or area they're interested in"),
    ],
  },
  motel: {
    booking: [
      ...CORE_BOOKING,
      sp("num_guests", "How many guests"),
      sp("room_type", "Which room type"),
    ],
    message: MESSAGE_CORE,
  },
  restaurant: {
    booking: [...CORE_BOOKING, { paths: ["party_size"], label: "The party size" }],
    message: MESSAGE_CORE,
  },
  generic: {
    booking: [...CORE_BOOKING, sp("reason", "The reason for the call")],
    message: MESSAGE_CORE,
  },
};

/** The vertical's built-in questions; an unknown vertical falls back to the generic list. */
export function builtInQuestionsFor(vertical: string | null | undefined): BuiltInQuestions {
  return (
    (vertical ? BUILT_IN_QUESTIONS[vertical] : undefined) ??
    (BUILT_IN_QUESTIONS["generic"] as BuiltInQuestions)
  );
}

// ---------------------------------------------------------------------
// reading what is stored
// ---------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** `overrides.custom_questions` -> a clean, position-ordered list for the editor (never throws; skips malformed elements). */
export function readCustomQuestions(overrides: unknown): CustomQuestion[] {
  const raw = record(overrides)?.["custom_questions"];
  if (!Array.isArray(raw)) return [];
  const out: CustomQuestion[] = [];
  raw.forEach((entry, index) => {
    const item = record(entry);
    if (!item) return;
    const id = typeof item["id"] === "string" ? item["id"] : "";
    const label = typeof item["label"] === "string" ? item["label"] : "";
    if (!CUSTOM_QUESTION_ID_PATTERN.test(id) || !label.trim()) return;
    const appliesTo = CUSTOM_QUESTION_APPLIES_TO.find((v) => v === item["applies_to"]) ?? "both";
    const hint = typeof item["hint"] === "string" && item["hint"].trim() ? item["hint"] : undefined;
    out.push({
      id,
      label,
      ...(hint ? { hint } : {}),
      required: item["required"] === true,
      applies_to: appliesTo,
      position: typeof item["position"] === "number" ? item["position"] : index,
      active: item["active"] !== false,
    });
  });
  return out.sort((a, b) => a.position - b.position);
}

export interface StoredCustomAnswer {
  question_id: string;
  question: string;
  answer: string;
}

/** `structured_payload.custom_answers` -> displayable entries (never throws). */
export function readCustomAnswers(payload: unknown): StoredCustomAnswer[] {
  const raw = record(payload)?.["custom_answers"];
  if (!Array.isArray(raw)) return [];
  const out: StoredCustomAnswer[] = [];
  for (const entry of raw) {
    const item = record(entry);
    const question = typeof item?.["question"] === "string" ? item["question"].trim() : "";
    const answer = typeof item?.["answer"] === "string" ? item["answer"].trim() : "";
    const id = typeof item?.["question_id"] === "string" ? item["question_id"] : "";
    if (question && answer) out.push({ question_id: id, question, answer });
  }
  return out;
}

/** `structured_payload` with the `custom_answers` key removed (the display renders it separately). */
export function withoutCustomAnswers(payload: Record<string, unknown>): Record<string, unknown> {
  const { custom_answers: _customAnswers, ...rest } = payload;
  return rest;
}
