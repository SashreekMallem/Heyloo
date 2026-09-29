/**
 * Static red-team lint for "no promise of a text without texting" (MSG-3,
 * docs/BUILD_NOTES.md). Owner decision: phone numbers are Retell-provided and
 * there is NO texting provider at launch, so a business can text only when it
 * has a carrier-verified SMS sender and a configured provider. Every agent
 * prompt, tool description and tool result must therefore be safe with texting
 * OFF: the model must never be led to say "I'm texting you a confirmation",
 * "te envío un mensaje", "a link is on its way".
 *
 * Two independent checks, both sentence-level and deliberately conservative
 * (a false positive fails a test and gets a wording fix; a false negative is a
 * promise reaching a caller):
 *
 * - `findUngatedTextInstructions(text)` — for AUTHORED prompt text (a template's
 *   system prompt, a state fragment, a tool description, the compiled global
 *   block). Any sentence that tells the model to send, offer or promise a
 *   text/SMS/payment link must be conditional on availability ("if text
 *   messages are available", "only when ...") or be a prohibition ("never",
 *   "do not"). Returns the offending sentences.
 * - `findTextPromises(text)` — for text the model may repeat almost verbatim (a
 *   tool result's `message`/`note`, the per-call OFF policy): no sentence may
 *   read as the assistant committing to, or reporting, a text (English or
 *   Spanish). Prohibitions such as "Do not say or imply that you are texting"
 *   are not promises and pass.
 */

/** Splits on sentence-ending punctuation followed by whitespace and a new sentence start. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?]["')\]]*)\s+(?=["']?[A-ZÁÉÍÓÚÑ¿¡])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** A sentence that instructs, offers or promises a text, SMS or payment link. */
const TEXT_INSTRUCTION =
  /\b(?:send(?:s|ing)?\b[^.;]{0,60}\b(?:sms|text|payment link|secure link)|(?:offer|offers) to text|text (?:you|them|him|her|the caller)\b|texting (?:you|them|the caller)\b|(?:will|would) (?:be )?texted|are texted|be texted|text (?:a|an|the|your)\b[^.;]{0,30}\b(?:confirmation|link|message)|sms confirmation|text confirmation|text (?:or|and) call\b|by text\b|link (?:for|to)\b[^.;]{0,40}\bwill follow)/i;

/** Conditional on availability, or a prohibition: the sentence cannot be a blanket promise. */
const GATE =
  /\b(?:available|unavailable|never|do not|don't|must not|cannot|can't|no link exists|no text)\b/i;

export function findUngatedTextInstructions(text: string): string[] {
  return splitSentences(text).filter((s) => TEXT_INSTRUCTION.test(s) && !GATE.test(s));
}

/** First-person commitments and delivery claims about a text, English and Spanish. */
const TEXT_PROMISE = new RegExp(
  [
    // "I'll text you", "I am texting", "we will send you a message", "I'm sending a text"
    String.raw`\b(?:i|we)(?:'ll|'m|'re|\s+will|\s+am|\s+are)\s+(?:going\s+to\s+)?(?:be\s+)?(?:text|texting|send|sending|message|messaging)\b`,
    // "you'll get a text", "you will receive a confirmation text", "you will be texted"
    String.raw`\byou(?:'ll|\s+will)\s+(?:get|receive|be\s+texted)\b`,
    String.raw`\bon its way\b`,
    String.raw`\b(?:has|have|was|were)\s+(?:just\s+)?been\s+sent\b`,
    String.raw`\bsent\s+(?:you|a|the)\s+(?:a\s+)?(?:text|sms|message|link|confirmation)\b`,
    // Spanish: "te envío", "le mando", "te enviaré un mensaje", "mensaje de texto", "un SMS"
    String.raw`\b(?:te|le|les|os)\s+(?:env[ií]o|env[ií]amos|enviar[eé]|enviaremos|mando|mandamos|mandar[eé]|mandaremos)\b`,
    String.raw`\bmensaje\s+de\s+texto\b`,
    String.raw`\bun\s+(?:texto|sms)\b`,
  ].join("|"),
  "i",
);

/** An instruction to the model NOT to say something ("Do not say or imply that a link is on
 * its way"): it names the promise in order to forbid it, so it is not itself a promise. */
const PROHIBITION =
  /\b(?:do not|don't|never|must not)\s+(?:say|tell|imply|claim|promise|mention|offer)\b/i;

export function findTextPromises(text: string): string[] {
  return splitSentences(text).filter((s) => TEXT_PROMISE.test(s) && !PROHIBITION.test(s));
}
