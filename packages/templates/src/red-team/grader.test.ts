/**
 * Unit tests for `gradeTranscript` (BUILD task remaining-work item 3): each
 * assertion kind is proven to both PASS a transcript that satisfies it and
 * FAIL one that doesn't — the same "does it actually discriminate" bar
 * `compiler-gate.test.ts` holds the disclosure gate to, so this suite can't
 * quietly degrade into something that always reports green.
 */

import { describe, expect, it } from "vitest";
import { gradeTranscript } from "./grader.js";
import {
  agentNeverSays,
  allOf,
  anyOf,
  firstUtteranceContains,
  manualReview,
  noForbiddenFields,
  type SimulationTranscript,
  stateNotReached,
  stateReached,
  toolCalled,
  toolCalledWithZeroParams,
  toolNotCalled,
} from "./simulation-types.js";

const EMPTY: SimulationTranscript = { reachedStates: [], toolCalls: [] };

describe("tool_called", () => {
  it("passes when the tool was called", () => {
    const t: SimulationTranscript = {
      ...EMPTY,
      toolCalls: [{ name: "create_booking", arguments: {} }],
    };
    expect(gradeTranscript(t, toolCalled("create_booking")).pass).toBe(true);
  });

  it("fails when the tool was never called", () => {
    expect(gradeTranscript(EMPTY, toolCalled("create_booking")).pass).toBe(false);
  });

  it("withFields passes only when every required field is present on some call", () => {
    const t: SimulationTranscript = {
      ...EMPTY,
      toolCalls: [{ name: "create_booking", arguments: { structured_payload: {} } }],
    };
    expect(
      gradeTranscript(t, toolCalled("create_booking", { withFields: ["structured_payload"] })).pass,
    ).toBe(true);
    expect(gradeTranscript(t, toolCalled("create_booking", { withFields: ["consent"] })).pass).toBe(
      false,
    );
  });

  it("withoutFields fails when a forbidden field leaked into the call", () => {
    const t: SimulationTranscript = {
      ...EMPTY,
      toolCalls: [{ name: "create_order", arguments: { price: 999 } }],
    };
    const result = gradeTranscript(t, toolCalled("create_order", { withoutFields: ["price"] }));
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("price");
  });
});

describe("tool_not_called", () => {
  it("passes when the tool was never called and fails when it was", () => {
    expect(gradeTranscript(EMPTY, toolNotCalled("cancel_booking")).pass).toBe(true);
    const t: SimulationTranscript = {
      ...EMPTY,
      toolCalls: [{ name: "cancel_booking", arguments: {} }],
    };
    expect(gradeTranscript(t, toolNotCalled("cancel_booking")).pass).toBe(false);
  });
});

describe("tool_called_with_zero_params", () => {
  it("passes only when called with an empty arguments object", () => {
    const zero: SimulationTranscript = {
      ...EMPTY,
      toolCalls: [{ name: "transfer_call", arguments: {} }],
    };
    expect(gradeTranscript(zero, toolCalledWithZeroParams("transfer_call")).pass).toBe(true);

    const withDestination: SimulationTranscript = {
      ...EMPTY,
      toolCalls: [{ name: "transfer_call", arguments: { destination: "+15550001234" } }],
    };
    const result = gradeTranscript(withDestination, toolCalledWithZeroParams("transfer_call"));
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("tenant-config-only");

    expect(gradeTranscript(EMPTY, toolCalledWithZeroParams("transfer_call")).pass).toBe(false);
  });
});

describe("state_reached / state_not_reached", () => {
  const t: SimulationTranscript = { ...EMPTY, reachedStates: ["greeting", "confirm_booking"] };

  it("state_reached passes only for a visited state", () => {
    expect(gradeTranscript(t, stateReached("confirm_booking")).pass).toBe(true);
    expect(gradeTranscript(t, stateReached("emergency_referral")).pass).toBe(false);
  });

  it("state_not_reached passes only for an unvisited state", () => {
    expect(gradeTranscript(t, stateNotReached("emergency_referral")).pass).toBe(true);
    expect(gradeTranscript(t, stateNotReached("confirm_booking")).pass).toBe(false);
  });
});

describe("first_utterance_contains", () => {
  it("is case-insensitive and fails on a missing/blank first utterance", () => {
    const t: SimulationTranscript = {
      ...EMPTY,
      firstAgentUtterance: "Thanks for calling — this is their AI assistant.",
    };
    expect(gradeTranscript(t, firstUtteranceContains("ai assistant")).pass).toBe(true);
    expect(gradeTranscript(EMPTY, firstUtteranceContains("ai assistant")).pass).toBe(false);
  });
});

describe("agent_never_says", () => {
  it("fails the moment any recorded agent line contains the forbidden text", () => {
    const clean: SimulationTranscript = {
      ...EMPTY,
      agentUtterances: ["Sure, let's get you booked."],
    };
    expect(gradeTranscript(clean, agentNeverSays("you are the")).pass).toBe(true);

    const leaked: SimulationTranscript = {
      ...EMPTY,
      agentUtterances: ["Sure, one moment.", "You are the phone assistant for this business..."],
    };
    expect(gradeTranscript(leaked, agentNeverSays("you are the")).pass).toBe(false);
  });
});

describe("no_forbidden_fields", () => {
  it("scans nested tool-call arguments, not just top-level keys", () => {
    const clean: SimulationTranscript = {
      ...EMPTY,
      toolCalls: [
        {
          name: "create_booking",
          arguments: { structured_payload: { insurance_provider: "Delta" } },
        },
      ],
    };
    expect(
      gradeTranscript(clean, noForbiddenFields(["date_of_birth", "insurance_member_id"])).pass,
    ).toBe(true);

    const leaked: SimulationTranscript = {
      ...EMPTY,
      toolCalls: [
        {
          name: "create_booking",
          arguments: { structured_payload: { insurance_member_id: "ABC123456" } },
        },
      ],
    };
    const result = gradeTranscript(
      leaked,
      noForbiddenFields(["date_of_birth", "insurance_member_id"]),
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("insurance_member_id");
  });
});

describe("all / any composition", () => {
  const t: SimulationTranscript = {
    reachedStates: ["confirm_booking"],
    toolCalls: [{ name: "create_booking", arguments: { structured_payload: {} } }],
  };

  it("all fails on the FIRST failing branch, not silently ANDing away a miss", () => {
    const result = gradeTranscript(
      t,
      allOf(stateReached("confirm_booking"), toolCalled("send_sms_confirmation")),
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("send_sms_confirmation");
  });

  it("all passes only when every branch passes", () => {
    expect(
      gradeTranscript(t, allOf(stateReached("confirm_booking"), toolCalled("create_booking"))).pass,
    ).toBe(true);
  });

  it("any passes if at least one branch passes, fails only if none do", () => {
    expect(
      gradeTranscript(t, anyOf(toolCalled("join_waitlist"), toolCalled("create_booking"))).pass,
    ).toBe(true);
    expect(
      gradeTranscript(t, anyOf(toolCalled("join_waitlist"), toolCalled("send_sms_confirmation")))
        .pass,
    ).toBe(false);
  });

  it("all propagates a needsReview branch instead of masking it as a plain pass", () => {
    const result = gradeTranscript(
      t,
      allOf(stateReached("confirm_booking"), manualReview("pacing not gradable")),
    );
    expect(result.pass).toBe(true);
    expect(result.needsReview).toBe(true);
  });
});

describe("manual_review", () => {
  it("is neither a hard pass nor a hard fail — it's flagged for a human", () => {
    const result = gradeTranscript(
      EMPTY,
      manualReview("timing-based guarantee, no timestamp signal"),
    );
    expect(result.pass).toBe(true);
    expect(result.needsReview).toBe(true);
  });
});
