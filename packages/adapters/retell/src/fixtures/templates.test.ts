import { zAgentTemplate } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import {
  AUTO_CONVERSATION_FLOW_TEMPLATE,
  LEGAL_MULTI_PROMPT_TEMPLATE,
  REAL_ESTATE_SINGLE_PROMPT_TEMPLATE,
} from "./templates.js";

describe("fixture templates are valid canonical AgentTemplates", () => {
  it.each([
    ["auto/conversation_flow", AUTO_CONVERSATION_FLOW_TEMPLATE],
    ["legal/multi_prompt", LEGAL_MULTI_PROMPT_TEMPLATE],
    ["real_estate/single_prompt", REAL_ESTATE_SINGLE_PROMPT_TEMPLATE],
  ])("%s parses against zAgentTemplate", (_label, template) => {
    expect(() => zAgentTemplate.parse(template)).not.toThrow();
  });
});
