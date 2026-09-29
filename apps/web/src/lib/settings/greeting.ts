/**
 * SETTINGS-1: the Greeting tab's preview of the AI's first sentence. The
 * old preview was hardcoded text that didn't match what callers hear. Since
 * DISCLOSE-1 the opening is spoken VERBATIM from the platform template's
 * `disclosure_line` (plus a returning-caller welcome and the opening
 * question) — mirrored here because `agent_templates` is platform-admin
 * only under RLS. Keep in sync with `_shared/compiler/template-compiler.ts`
 * (`DISCLOSURE_TRANSLATIONS`, `OPENING_QUESTION`) and
 * `_shared/inbound-dynamic-variables.ts` (`DEFAULT_ASSISTANT_NAME`).
 */

/**
 * DISCLOSE-2: a persona name, never a description — the disclosure literal
 * already says "their AI assistant", so a descriptive fallback made callers
 * hear "This is the AI assistant, their AI assistant".
 */
export const DEFAULT_ASSISTANT_NAME = "Ava";

export function openingLinePreview(params: {
  businessName: string;
  assistantName: string;
  language: string;
}): string {
  const business = params.businessName.trim() || "your business";
  const language = params.language === "es" ? "es" : "en";
  const assistant = params.assistantName.trim() || DEFAULT_ASSISTANT_NAME;
  if (language === "es") {
    return `Gracias por llamar a ${business}. Le atiende ${assistant}, su asistente de inteligencia artificial; esta llamada puede ser grabada. ¿En qué puedo ayudarle hoy?`;
  }
  return `Thanks for calling ${business}. This is ${assistant}, their AI assistant — this call may be recorded. How can I help you today?`;
}
