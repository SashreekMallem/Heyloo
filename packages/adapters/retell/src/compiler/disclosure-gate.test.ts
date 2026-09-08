import { describe, expect, it } from "vitest";
import { firstTurnText, verifyDisclosureGate } from "./disclosure-gate.js";
import type { RetellFlowRequest } from "./types.js";

const DISCLOSURE = "This call may be recorded.";

function conversationFlowFixture(startText: string): RetellFlowRequest {
  return {
    kind: "conversation_flow",
    body: {
      start_node_id: "n1",
      start_speaker: "agent",
      nodes: [
        {
          id: "n1",
          type: "conversation",
          name: "Start",
          instruction: { type: "prompt", text: startText },
          edges: [],
        },
      ],
      tools: [],
    },
  };
}

function multiPromptFixture(startPrompt: string): RetellFlowRequest {
  return {
    kind: "multi_prompt",
    body: {
      general_prompt: "shared context",
      starting_state: "s1",
      states: [{ name: "s1", state_prompt: startPrompt, edges: [], tools: [] }],
    },
  };
}

function singlePromptFixture(generalPrompt: string): RetellFlowRequest {
  return { kind: "single_prompt", body: { general_prompt: generalPrompt, general_tools: [] } };
}

describe("firstTurnText", () => {
  it("extracts the start node's instruction text for conversation_flow", () => {
    expect(firstTurnText(conversationFlowFixture(`${DISCLOSURE} Hello!`))).toBe(
      `${DISCLOSURE} Hello!`,
    );
  });

  it("extracts the starting_state's state_prompt for multi_prompt", () => {
    expect(firstTurnText(multiPromptFixture(`${DISCLOSURE} Hi there.`))).toBe(
      `${DISCLOSURE} Hi there.`,
    );
  });

  it("extracts general_prompt for single_prompt", () => {
    expect(firstTurnText(singlePromptFixture(`${DISCLOSURE}\n\nrest`))).toBe(
      `${DISCLOSURE}\n\nrest`,
    );
  });

  it("returns empty string when the conversation_flow start node id doesn't resolve", () => {
    const flow = conversationFlowFixture("whatever");
    if (flow.kind === "conversation_flow") flow.body.start_node_id = "nonexistent";
    expect(firstTurnText(flow)).toBe("");
  });
});

describe("verifyDisclosureGate", () => {
  it("passes when the disclosure line is present verbatim in the first turn", () => {
    expect(verifyDisclosureGate(conversationFlowFixture(`${DISCLOSURE} Hello!`), DISCLOSURE)).toBe(
      true,
    );
  });

  it("FAILS the gate when the disclosure line is entirely absent (the case it exists to catch)", () => {
    expect(
      verifyDisclosureGate(conversationFlowFixture("Hello, how can I help?"), DISCLOSURE),
    ).toBe(false);
  });

  it("FAILS when the text is only a near-paraphrase, not verbatim", () => {
    expect(
      verifyDisclosureGate(
        conversationFlowFixture("This call might be recorded, hello!"),
        DISCLOSURE,
      ),
    ).toBe(false);
  });

  it("fails closed when disclosure_line itself is empty", () => {
    expect(verifyDisclosureGate(conversationFlowFixture("anything at all"), "")).toBe(false);
  });

  it("passes for multi_prompt when present in the starting state only", () => {
    expect(verifyDisclosureGate(multiPromptFixture(`${DISCLOSURE} welcome`), DISCLOSURE)).toBe(
      true,
    );
  });

  it("passes for single_prompt when present at the start of general_prompt", () => {
    expect(verifyDisclosureGate(singlePromptFixture(`${DISCLOSURE}\n\nmore`), DISCLOSURE)).toBe(
      true,
    );
  });
});
