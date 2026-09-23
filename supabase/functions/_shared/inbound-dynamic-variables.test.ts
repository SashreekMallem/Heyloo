import { describe, expect, it } from "vitest";
import { resolveRetellAgentLanguage } from "./inbound-dynamic-variables.ts";

/**
 * QA-HOT (docs/BUILD_NOTES.md): `resolveRetellAgentLanguage` is the
 * mapping `_shared/provisioning/compile-and-publish.ts`'s `createAgent`
 * call uses to set Retell's own agent-level `language` field (STT locale
 * + default TTS voice) from `tenants.language_config.primary`
 * (`AGENT_LANGUAGES` — `packages/canonical-types/src/schemas/
 * agent-language.ts` — a bare ISO 639-1 short code, `"en"`/`"es"`).
 * RETELL-VERIFIED (docs.retellai.com/api-references/create-agent,
 * 2026-09-23, docs/VERIFY.md QA-HOT): the supported locale set has no
 * bare `es-US` — `es-419` (Latin American Spanish) is the closest match
 * for a US-based tenant's Spanish-speaking callers.
 */
describe("resolveRetellAgentLanguage", () => {
  it("maps the English short code to en-US", () => {
    expect(resolveRetellAgentLanguage("en")).toBe("en-US");
  });

  it("maps the Spanish short code to es-419 (no bare es-US in Retell's supported set)", () => {
    expect(resolveRetellAgentLanguage("es")).toBe("es-419");
  });

  it("falls back to en-US for any unrecognized short code, never leaving the field unset", () => {
    expect(resolveRetellAgentLanguage("fr")).toBe("en-US");
    expect(resolveRetellAgentLanguage("")).toBe("en-US");
  });
});
