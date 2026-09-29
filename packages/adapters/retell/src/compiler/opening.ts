/**
 * DISCLOSE-1 (docs/BUILD_NOTES.md): the static opening line and the
 * transfer-announcement wording, kept in PARITY with the live Deno compiler
 * (`supabase/functions/_shared/compiler/template-compiler.ts` —
 * `buildOpeningLine`, `NO_TRANSFER_FALLBACK_INSTRUCTION`,
 * `TRANSFER_ANNOUNCEMENT_INSTRUCTION`; `parity.test.ts` compiles the same
 * fixture through both and compares the opening text).
 *
 * Why a static opening: VERIFY-DEPLOY heard live calls drop "this call may
 * be recorded" because the disclosure lived in a prompt the model
 * paraphrased. CLAUDE.md Rule 2 requires the AI + recording disclosure in
 * every greeting, so the first utterance is now spoken verbatim — a
 * conversation-flow `static_text` start node, or a retell-llm
 * `begin_message` (both RETELL-VERIFIED, see `types.ts`).
 */

/** Always set by `voice-inbound` (blank for a new caller); spoken by the opening line. Dynamic variables are substituted in "The opening message, Conversation Flow static sentences" (docs.retellai.com/build/dynamic-variables, 2026-09-29). */
export const CALLER_GREETING_TOKEN = "{{caller_greeting}}";

const DEFAULT_OPENING_LANGUAGE = "en";

const OPENING_QUESTION: Record<string, string> = {
  en: "How can I help you today?",
  es: "¿En qué puedo ayudarle hoy?",
};

/** Compiler-owned translations of an EXACT English disclosure literal — mirrors the Deno compiler's table byte for byte. */
const DISCLOSURE_TRANSLATIONS: Record<string, Record<string, string>> = {
  "Thanks for calling {{business_name}}. This is {{assistant_name}}, their AI assistant — this call may be recorded.":
    {
      es: "Gracias por llamar a {{business_name}}. Le atiende {{assistant_name}}, su asistente de inteligencia artificial; esta llamada puede ser grabada.",
    },
};

export interface OpeningLine {
  text: string;
  disclosureLiteral: string;
  language: string;
}

export function buildOpeningLine(
  disclosureLine: string,
  language: string = DEFAULT_OPENING_LANGUAGE,
): OpeningLine {
  const translated =
    language === DEFAULT_OPENING_LANGUAGE
      ? undefined
      : DISCLOSURE_TRANSLATIONS[disclosureLine]?.[language];
  const effectiveLanguage =
    translated !== undefined && OPENING_QUESTION[language] !== undefined
      ? language
      : DEFAULT_OPENING_LANGUAGE;
  const disclosureLiteral =
    effectiveLanguage === language && translated ? translated : disclosureLine;
  const question =
    OPENING_QUESTION[effectiveLanguage] ?? OPENING_QUESTION[DEFAULT_OPENING_LANGUAGE];
  return {
    text: `${disclosureLiteral} ${CALLER_GREETING_TOKEN} ${question}`,
    disclosureLiteral,
    language: effectiveLanguage,
  };
}

/**
 * DISCLOSE-1 review (mirrors template-compiler.ts `OPENING_CUT_OFF_RECOVERY`):
 * a retell-llm `begin_message` has no per-message "block interruptions"
 * switch, so a caller who talks over it can cut the recording clause off —
 * the one case where the model must say it again.
 */
const OPENING_CUT_OFF_RECOVERY =
  "The one exception: if the caller spoke over that line and it was cut off before the AI and " +
  "call-recording notice was finished, begin your reply with one short sentence saying you are " +
  "an AI assistant and that this call may be recorded, then answer them.";

/**
 * DISCLOSE-1 review (mirrors template-compiler.ts): the conversation-flow
 * opening node's node-level `interruption_sensitivity` — Retell's documented
 * recording-disclaimer setup is a static-text start node with "Block
 * Interruptions" on "so the user can't cut it off" (docs.retellai.com/
 * accounts/privacy-disable, 2026-09-29); `0` = "agent would never be
 * interrupted" (retell-sdk `interruption_sensitivity`), for this node only.
 */
export const OPENING_INTERRUPTION_SENSITIVITY = 0;

/** Prepended to the start state's own instruction — the start state no longer speaks first, so it must not greet again. */
export function openingAlreadySpokenInstruction(opening: OpeningLine): string {
  return (
    `Your first turn in this call has ALREADY been spoken, word for word: "${opening.text}" — ` +
    "it greeted the caller (welcoming a recognized returning caller back by name) and gave the " +
    "AI and call-recording disclosure. Do not greet the caller again, re-introduce yourself, or " +
    "repeat that line; respond directly to what the caller just said. " +
    OPENING_CUT_OFF_RECOVERY +
    " If they ask whether they are talking to a real person, say plainly that you are an AI " +
    "assistant and that the call may be recorded."
  );
}

/** Defaults for every variable the compiler itself references. */
export const COMPILER_DEFAULT_DYNAMIC_VARIABLES: Readonly<Record<string, string>> = {
  caller_greeting: "",
  transfer_number: "",
  // SETTINGS-2: safe "nothing set" values for the owner-info block's variables (parity with the Deno compiler's table).
  special_instructions: "",
  faq_text: "(no FAQ entries have been added)",
  business_facts: "(nothing extra on file)",
  voicemail_message: "",
  booking_mode_text: "Normal — you can book, reschedule and cancel appointments as usual.",
  transfer_policy_text:
    "No live transfer number is set. Do not offer or attempt a transfer: take a message instead.",
  cancellation_policy_text:
    "we ask that you let us know as soon as possible if you need to cancel or reschedule",
};

const NEVER_CLAIM_A_TRANSFER_RULE =
  "There is NO live transfer on this call: nobody from the team can be connected right now " +
  "(no live line is available, or the connection attempt just failed). Never say or imply that " +
  "you are connecting, transferring or putting the caller through, that someone is joining or " +
  "already on the line, or that the team is aware of this call right now — none of that is " +
  "happening, and saying it could leave a caller waiting for help that is not coming.";

/** DISCLOSE-1 review (mirrors template-compiler.ts): never a second take_message on one call. */
const NO_DUPLICATE_MESSAGE_RULE =
  "If take_message was already called earlier in this call, do not offer or take another " +
  "message — tell them their message is already with the team and someone will call back, then " +
  "the call is done.";

export const NO_TRANSFER_FALLBACK_INSTRUCTION =
  `${NEVER_CLAIM_A_TRANSFER_RULE} If the caller has described an emergency, first restate the ` +
  "emergency referral in this same turn — exactly where to go or whom to call right now — and " +
  'answer any "should I go now?" question with a clear yes; a callback is never a substitute ' +
  "for emergency care. Then, once, clearly and warmly, say you can't connect them to someone " +
  "right now and offer to take down their name, phone number, and a short message so the team " +
  "can call them back — never repeat that same apology/offer a third time. If they give a " +
  "callback number, call take_message with it (fold in whatever they've already told you) and " +
  "let them know someone will call back as soon as possible, then the call is done. " +
  NO_DUPLICATE_MESSAGE_RULE +
  " If they keep insisting on a transfer or won't give a number after you've offered twice, " +
  "don't keep repeating yourself: calmly acknowledge you can't do more right now and that's the " +
  "end of what you can help with today — the call is done either way.";

export const TRANSFER_ANNOUNCEMENT_INSTRUCTION =
  "In one short, warm sentence, tell the caller you're connecting them to a member of the team " +
  "now. Say nothing else.";

/**
 * Retell-llm targets: the model may never announce a connection on its own —
 * only a transfer_call invocation (which announces itself) may. Kept compact
 * (vs. the Deno compiler's full `TRANSFER_TOOL_OR_FALLBACK_INSTRUCTION`) so
 * the real `generic` single-prompt template stays under
 * `registry-consistency.test.ts`'s 2000-word hard ceiling; the rule itself
 * is identical.
 */
export const NEVER_ANNOUNCE_WITHOUT_TRANSFER_INSTRUCTION =
  'Only call transfer_call when the live transfer number ("{{transfer_number}}") is a real ' +
  "phone number — the transfer announces itself. Never tell the caller you are connecting, " +
  "transferring or putting them through unless you are calling transfer_call in this same " +
  "turn. If the number is blank, say honestly that you can't connect them to someone right " +
  "now, restate any emergency referral first, and offer to take a message.";
