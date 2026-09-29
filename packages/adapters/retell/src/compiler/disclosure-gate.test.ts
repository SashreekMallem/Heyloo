import { describe, expect, it } from "vitest";
import { firstTurnText, firstUtterance, verifyDisclosureGate } from "./disclosure-gate.js";
import type { RetellFlowRequest } from "./types.js";

const DISCLOSURE = "This call may be recorded.";

function conversationFlowFixture(
  startText: string,
  instructionType: "prompt" | "static_text" = "static_text",
  /** `null` omits the field (the pre-review opening node shape). */
  interruptionSensitivity: number | null = 0,
): RetellFlowRequest {
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
          instruction: { type: instructionType, text: startText },
          ...(interruptionSensitivity !== null
            ? { interruption_sensitivity: interruptionSensitivity }
            : {}),
          edges: [],
        },
      ],
      tools: [],
    },
  };
}

function multiPromptFixture(beginMessage: string): RetellFlowRequest {
  return {
    kind: "multi_prompt",
    body: {
      begin_message: beginMessage,
      start_speaker: "agent",
      general_prompt: "shared context",
      starting_state: "s1",
      states: [{ name: "s1", state_prompt: `${DISCLOSURE} prompt only`, edges: [], tools: [] }],
      general_tools: [],
    },
  };
}

function singlePromptFixture(beginMessage: string): RetellFlowRequest {
  return {
    kind: "single_prompt",
    body: {
      begin_message: beginMessage,
      start_speaker: "agent",
      general_prompt: `${DISCLOSURE}\n\nrest`,
      general_tools: [],
    },
  };
}

describe("firstUtterance (DISCLOSE-1)", () => {
  it("a conversation_flow static_text start node is a static first utterance", () => {
    expect(firstUtterance(conversationFlowFixture(`${DISCLOSURE} Hello!`))).toEqual({
      isStatic: true,
      text: `${DISCLOSURE} Hello!`,
      blocksInterruptions: true,
    });
  });

  it("a PROMPT start node is model-generated, never static", () => {
    expect(firstUtterance(conversationFlowFixture(`${DISCLOSURE} Hello!`, "prompt")).isStatic).toBe(
      false,
    );
  });

  it("a retell-llm begin_message is the static first utterance (multi_prompt and single_prompt)", () => {
    expect(firstUtterance(multiPromptFixture(`${DISCLOSURE} Hi there.`))).toEqual({
      isStatic: true,
      text: `${DISCLOSURE} Hi there.`,
      blocksInterruptions: false,
    });
    expect(firstTurnText(singlePromptFixture(`${DISCLOSURE} Hi.`))).toBe(`${DISCLOSURE} Hi.`);
  });

  it("an empty begin_message is not a static utterance (Retell: the agent then waits for the user)", () => {
    expect(firstUtterance(multiPromptFixture("")).isStatic).toBe(false);
  });

  it("returns a non-static empty utterance when the conversation_flow start node id doesn't resolve", () => {
    const flow = conversationFlowFixture("whatever");
    if (flow.kind === "conversation_flow") flow.body.start_node_id = "nonexistent";
    expect(firstUtterance(flow)).toEqual({ isStatic: false, text: "", blocksInterruptions: false });
  });
});

describe("verifyDisclosureGate", () => {
  it("passes when the disclosure line is present verbatim in a STATIC first utterance", () => {
    expect(verifyDisclosureGate(conversationFlowFixture(`${DISCLOSURE} Hello!`), DISCLOSURE)).toBe(
      true,
    );
    expect(verifyDisclosureGate(multiPromptFixture(`${DISCLOSURE} welcome`), DISCLOSURE)).toBe(
      true,
    );
    expect(verifyDisclosureGate(singlePromptFixture(`${DISCLOSURE} hi`), DISCLOSURE)).toBe(true);
  });

  it("DISCLOSE-1: FAILS when the disclosure is only in a prompt the model paraphrases", () => {
    expect(
      verifyDisclosureGate(conversationFlowFixture(`${DISCLOSURE} Hello!`, "prompt"), DISCLOSURE),
    ).toBe(false);
    // The starting state's prompt and general_prompt both contain it, but
    // with no begin_message the first utterance is model-generated.
    expect(verifyDisclosureGate(multiPromptFixture(""), DISCLOSURE)).toBe(false);
    expect(verifyDisclosureGate(singlePromptFixture(""), DISCLOSURE)).toBe(false);
  });

  it("DISCLOSE-1 review: FAILS a conversation_flow whose static opening the caller can cut off (the recording clause is at its end)", () => {
    for (const sensitivity of [null, 1, 0.5]) {
      const flow = conversationFlowFixture(`${DISCLOSURE} Hello!`, "static_text", sensitivity);
      expect(firstUtterance(flow).blocksInterruptions).toBe(false);
      expect(verifyDisclosureGate(flow, DISCLOSURE)).toBe(false);
    }
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
});
