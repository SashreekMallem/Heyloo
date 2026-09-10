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
    const tool = result.general_tools[0];
    expect(tool?.type).toBe("custom");
    if (tool?.type === "custom") {
      expect(tool.url).toBe(TOOL_WEBHOOK_URL);
    }
  });

  it("compiles a declared transfer_call tool to Retell's native transfer_call tool, not a custom webhook (GAP_REGISTER §1.4 item 4)", () => {
    const withTransfer = {
      ...REAL_ESTATE_SINGLE_PROMPT_TEMPLATE,
      tools: [
        ...REAL_ESTATE_SINGLE_PROMPT_TEMPLATE.tools,
        {
          name: "transfer_call",
          description: "Warm-transfer the caller to a human.",
          parameters: { type: "object" as const, properties: {}, required: [] },
          authorization: { scope: "tenant_config_only" as const },
        },
      ],
    };
    const result = compileSinglePrompt(withTransfer, TOOL_WEBHOOK_URL);
    const transferTool = result.general_tools.find((t) => t.name === "transfer_call");
    expect(transferTool?.type).toBe("transfer_call");
    if (transferTool?.type === "transfer_call") {
      expect(transferTool.transfer_destination).toEqual({
        type: "predefined",
        number: "{{transfer_number}}",
      });
      expect(transferTool.transfer_option).toEqual({ type: "warm_transfer" });
    }
  });
});
