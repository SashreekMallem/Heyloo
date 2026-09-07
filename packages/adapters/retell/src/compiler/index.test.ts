import type { AgentTemplate } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import {
  AUTO_CONVERSATION_FLOW_TEMPLATE,
  LEGAL_MULTI_PROMPT_TEMPLATE,
  REAL_ESTATE_SINGLE_PROMPT_TEMPLATE,
} from "../fixtures/templates.js";
import { compileRetellTemplate, compileTemplateArtifact } from "./index.js";

const TOOL_WEBHOOK_URL = "https://example.supabase.co/functions/v1/voice-tools";

describe("compileRetellTemplate — one per compile_target", () => {
  it.each([
    ["conversation_flow", AUTO_CONVERSATION_FLOW_TEMPLATE],
    ["multi_prompt", LEGAL_MULTI_PROMPT_TEMPLATE],
    ["single_prompt", REAL_ESTATE_SINGLE_PROMPT_TEMPLATE],
  ] as const)("passes the disclosure gate for the %s fixture", (target, template) => {
    const compiled = compileRetellTemplate(template, target, TOOL_WEBHOOK_URL);
    expect(compiled.compileTarget).toBe(target);
    expect(compiled.disclosureVerified).toBe(true);
    expect(compiled.flowRequest.kind).toBe(target);
  });

  it("FAILS the disclosure gate when disclosure_line is missing entirely from a template's own text (defense-in-depth: a template with an empty prompt_fragment on the start state)", () => {
    const brokenTemplate: AgentTemplate = {
      ...AUTO_CONVERSATION_FLOW_TEMPLATE,
      disclosure_line: "", // canonical schema forbids this in practice (min length 1) — simulated here directly against the compiler
    };
    const compiled = compileRetellTemplate(brokenTemplate, "conversation_flow", TOOL_WEBHOOK_URL);
    expect(compiled.disclosureVerified).toBe(false);
  });
});

describe("compileTemplateArtifact — canonical VoiceProvider.compileTemplate contract", () => {
  it("wraps the compiled result as a CompiledAgentArtifact with providerPayload opaque to callers", () => {
    const artifact = compileTemplateArtifact(
      AUTO_CONVERSATION_FLOW_TEMPLATE,
      "conversation_flow",
      TOOL_WEBHOOK_URL,
    );
    expect(artifact.compileTarget).toBe("conversation_flow");
    expect(artifact.disclosureVerified).toBe(true);
    expect(artifact.providerPayload).toBeDefined();
  });
});
