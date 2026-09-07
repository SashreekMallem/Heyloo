/**
 * The one red-team guarantee that genuinely requires running the T2
 * compiler rather than just inspecting the canonical `AgentTemplate`
 * (BUILD task item 3: "disclosure line present in first turn of compiled
 * output for every compile_target"). Uses `RetellProvider.compileTemplate`
 * — the PUBLIC `VoiceProvider` method (`@heyloo/adapter-retell`'s only
 * exported entry point besides pure canonical-type re-exports) — never a
 * deep import into the adapter's internal `compiler/*` modules or a
 * Retell-shaped payload type (CLAUDE.md Rule 2: provider-specific shapes
 * stay inside `packages/adapters/*`). `artifact.providerPayload` is typed
 * `unknown` here and deliberately never narrowed/inspected — only the
 * canonical `disclosureVerified` boolean is asserted.
 */

import { RetellProvider } from "@heyloo/adapter-retell";
import { describe, expect, it } from "vitest";
import { TEMPLATE_DEFINITIONS } from "../registry.js";

const provider = new RetellProvider({
  apiKey: "red-team-test-key",
  defaultToolWebhookUrl: "https://example.supabase.co/functions/v1/voice-tools",
});

describe("every template compiles with its disclosure line verified, for its own compile_target", () => {
  for (const { key, template } of TEMPLATE_DEFINITIONS) {
    it(`${key} (${template.compile_target}) passes the disclosure publish gate`, () => {
      const artifact = provider.compileTemplate(template, template.compile_target);
      expect(artifact.compileTarget).toBe(template.compile_target);
      expect(artifact.disclosureVerified).toBe(true);
    });
  }
});

describe("the disclosure gate actually discriminates: a blank disclosure_line fails it", () => {
  for (const { key, template } of TEMPLATE_DEFINITIONS) {
    it(`${key} would fail the gate if disclosure_line were ever blanked out`, () => {
      const tampered = { ...template, disclosure_line: "" };
      // The canonical schema itself refuses an empty disclosure_line (zAgentTemplate
      // requires min(1)) — this proves the compiler's OWN independent gate agrees,
      // belt-and-suspenders, rather than relying on schema validation alone.
      const artifact = provider.compileTemplate(tampered, tampered.compile_target);
      expect(artifact.disclosureVerified).toBe(false);
    });
  }
});
