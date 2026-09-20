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

  // OPS-5 (docs/BUILD_NOTES.md): closes the gap conversation-flow.ts's own
  // docstring used to flag — a `transferNumber` passed at this, the
  // PUBLIC `VoiceProvider.compileTemplate` entry point, now really does
  // reach the compiled `transfer_call` node, the same way it already did
  // when calling `compileConversationFlow` directly (that function's own
  // test file covers the compiled-node shape in detail; this just proves
  // the option isn't dropped anywhere in the
  // compileTemplateArtifact -> compileRetellTemplate -> buildFlowRequest
  // -> compileConversationFlow chain).
  const templateWithTransferState: AgentTemplate = {
    ...AUTO_CONVERSATION_FLOW_TEMPLATE,
    states: [
      ...AUTO_CONVERSATION_FLOW_TEMPLATE.states,
      {
        id: "transfer_to_human",
        name: "Transfer to human",
        prompt_fragment: "Connecting you now.",
        allowed_tools: ["transfer_call"],
        is_terminal: true,
      },
    ],
    tools: [
      ...AUTO_CONVERSATION_FLOW_TEMPLATE.tools,
      {
        name: "transfer_call",
        description: "Warm-transfer the caller to a human.",
        parameters: { type: "object", properties: {}, required: [] },
        authorization: { scope: "tenant_config_only" },
      },
    ],
  };

  it("threads a caller-supplied transferNumber through to the compiled transfer_call node's destination", () => {
    const artifact = compileTemplateArtifact(
      templateWithTransferState,
      "conversation_flow",
      TOOL_WEBHOOK_URL,
      { transferNumber: "+15551234567" },
    );
    const payload = artifact.providerPayload as {
      flowRequest: { kind: string; body: { nodes: { id: string; type: string }[] } };
    };
    const transferNode = payload.flowRequest.body.nodes.find((n) => n.id === "transfer_to_human");
    expect(transferNode?.type).toBe("transfer_call");
    expect(
      (transferNode as unknown as { transfer_destination: { number: string } }).transfer_destination
        .number,
    ).toBe("+15551234567");
  });

  it("omitting options keeps compiling the honest no-transfer-number fallback (back-compat, unchanged behavior)", () => {
    const artifact = compileTemplateArtifact(
      templateWithTransferState,
      "conversation_flow",
      TOOL_WEBHOOK_URL,
    );
    const payload = artifact.providerPayload as {
      flowRequest: { kind: string; body: { nodes: { id: string; type: string }[] } };
    };
    const transferNode = payload.flowRequest.body.nodes.find((n) => n.id === "transfer_to_human");
    expect(transferNode?.type).not.toBe("transfer_call");
  });
});
