import { describe, expect, it } from "vitest";
import { REAL_ESTATE_SINGLE_PROMPT_TEMPLATE } from "../fixtures/templates.js";
import { compileSinglePrompt } from "./single-prompt.js";

const TOOL_WEBHOOK_URL = "https://example.supabase.co/functions/v1/voice-tools";

describe("compileSinglePrompt", () => {
  it("matches the golden-file snapshot for the real_estate vertical fixture", () => {
    expect(
      compileSinglePrompt(REAL_ESTATE_SINGLE_PROMPT_TEMPLATE, TOOL_WEBHOOK_URL),
    ).toMatchSnapshot();
  });

  it("prepends disclosure_line verbatim as the very first line of general_prompt", () => {
    const result = compileSinglePrompt(REAL_ESTATE_SINGLE_PROMPT_TEMPLATE, TOOL_WEBHOOK_URL);
    expect(
      result.general_prompt.startsWith(REAL_ESTATE_SINGLE_PROMPT_TEMPLATE.disclosure_line),
    ).toBe(true);
  });

  it("includes system_prompt content", () => {
    const result = compileSinglePrompt(REAL_ESTATE_SINGLE_PROMPT_TEMPLATE, TOOL_WEBHOOK_URL);
    expect(result.general_prompt).toContain(REAL_ESTATE_SINGLE_PROMPT_TEMPLATE.system_prompt);
  });

  it("wires general_tools to the given toolWebhookUrl", () => {
    const result = compileSinglePrompt(REAL_ESTATE_SINGLE_PROMPT_TEMPLATE, TOOL_WEBHOOK_URL);
    expect(result.general_tools).toHaveLength(1);
    expect(result.general_tools[0]?.url).toBe(TOOL_WEBHOOK_URL);
  });
});
