/**
 * `RetellProvider` — the `VoiceProvider` (from `@heyloo/canonical-types`)
 * implementation for Retell. This class is the ONLY thing this package
 * exports for use outside itself (besides the pure canonical-type re-exports
 * already available from `@heyloo/canonical-types` directly) — every method
 * takes/returns canonical types, never a Retell payload shape
 * (CLAUDE.md Rule 2).
 */

import type {
  AgentTemplate,
  CallEndedEvent,
  CompiledAgentArtifact,
  CompileTarget,
  CreateOrUpdateAgentInput,
  CreateOrUpdateAgentResult,
  ImportPhoneNumberInput,
  ImportPhoneNumberResult,
  InboundCallContext,
  InboundCallResolution,
  ProviderCapabilities,
  PublishAgentVersionInput,
  PublishAgentVersionResult,
  ToolCallRequest,
  ToolCallResult,
  VerifyWebhookSignatureInput,
  VerifyWebhookSignatureResult,
  VoiceProvider,
} from "@heyloo/canonical-types";
import { createOrUpdateRetellAgent, publishRetellAgentVersion } from "./agents.js";
import { verifyAndParseRetellCallEndedWebhook } from "./call-events.js";
import { RETELL_API_BASE_URL, RetellClient } from "./client.js";
import { compileRetellTemplate, compileTemplateArtifact } from "./compiler/index.js";
import { buildRetellInboundResponse, resolveRetellInboundCall } from "./inbound.js";
import { importTwilioNumberIntoRetell } from "./numbers.js";
import { verifyRetellWebhookSignature } from "./signature.js";
import { buildRetellToolCallResponse, verifyAndParseRetellToolCall } from "./tool-call.js";

export interface RetellProviderOptions {
  apiKey: string;
  baseUrl?: string;
  /**
   * Default `/voice/tools` URL used by the standalone `compileTemplate`
   * method (which, unlike `createOrUpdateAgent`, has no per-call
   * `toolWebhookUrl` on the canonical `VoiceProvider` interface — see
   * compiler/index.ts). `createOrUpdateAgent` always uses its OWN input's
   * `toolWebhookUrl` instead, so this only matters for template-compile-only
   * callers (e.g. T6's batch-simulation CI harness).
   */
  defaultToolWebhookUrl: string;
}

export const RETELL_CAPABILITIES: ProviderCapabilities = {
  supportsConversationFlow: true,
  supportsMultiPrompt: true,
  supportsSinglePrompt: true,
  supportsGlobalIntents: true,
  supportsWarmTransferContext: true,
  supportsNativeSmsChannel: true,
  supportsBatchSimulationTesting: true,
  supportsConcurrencyQuery: true,
  supportsPhoneNumberImport: true,
  costGranularity: "exact",
};

export class RetellProvider implements VoiceProvider {
  readonly name = "retell";
  readonly capabilities = RETELL_CAPABILITIES;

  private readonly client: RetellClient;
  private readonly apiKey: string;
  private readonly defaultToolWebhookUrl: string;

  constructor(options: RetellProviderOptions) {
    this.apiKey = options.apiKey;
    this.defaultToolWebhookUrl = options.defaultToolWebhookUrl;
    this.client = new RetellClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? RETELL_API_BASE_URL,
    });
  }

  async createOrUpdateAgent(input: CreateOrUpdateAgentInput): Promise<CreateOrUpdateAgentResult> {
    const compiled = compileRetellTemplate(
      input.template,
      input.template.compile_target,
      input.toolWebhookUrl,
    );
    return createOrUpdateRetellAgent(this.client, input, compiled);
  }

  async publishAgentVersion(input: PublishAgentVersionInput): Promise<PublishAgentVersionResult> {
    return publishRetellAgentVersion(this.client, input);
  }

  async importPhoneNumber(input: ImportPhoneNumberInput): Promise<ImportPhoneNumberResult> {
    return importTwilioNumberIntoRetell(this.client, input);
  }

  verifyWebhookSignature(input: VerifyWebhookSignatureInput): VerifyWebhookSignatureResult {
    return verifyRetellWebhookSignature({ ...input, apiKey: this.apiKey });
  }

  resolveInboundCall(rawBody: string): InboundCallContext {
    return resolveRetellInboundCall(rawBody);
  }

  buildInboundResponse(resolution: InboundCallResolution): unknown {
    return buildRetellInboundResponse(resolution);
  }

  verifyAndParseToolCall(rawBody: string, signatureHeader: string | null): ToolCallRequest {
    return verifyAndParseRetellToolCall(rawBody, signatureHeader, this.apiKey);
  }

  buildToolCallResponse(result: ToolCallResult): unknown {
    return buildRetellToolCallResponse(result);
  }

  verifyAndParseCallEndedWebhook(rawBody: string, signatureHeader: string | null): CallEndedEvent {
    return verifyAndParseRetellCallEndedWebhook(rawBody, signatureHeader, this.apiKey);
  }

  compileTemplate(template: AgentTemplate, target: CompileTarget): CompiledAgentArtifact {
    return compileTemplateArtifact(template, target, this.defaultToolWebhookUrl);
  }
}
