/**
 * The programmatic grader (BUILD task remaining-work item 3): checks a
 * `SimulationTranscript` against a `SimulationAssertion` and emits a real
 * pass/fail, never prose matching. Pure and provider-agnostic — takes only
 * the canonical `SimulationTranscript` shape (`simulation-types.ts`), never
 * a Retell-specific `transcript_snapshot`; a real client implementation
 * (`packages/adapters/retell`, once built — see that file's header) is
 * responsible for normalizing Retell's own transcript/tool-call log into
 * this shape before it ever reaches this function.
 */

import type {
  GradeResult,
  RecordedToolCall,
  SimulationAssertion,
  SimulationTranscript,
} from "./simulation-types.js";

function findCalls(transcript: SimulationTranscript, tool: string): readonly RecordedToolCall[] {
  return transcript.toolCalls.filter((c) => c.name === tool);
}

function pass(reason: string): GradeResult {
  return { pass: true, needsReview: false, reason };
}

function fail(reason: string): GradeResult {
  return { pass: false, needsReview: false, reason };
}

export function gradeTranscript(
  transcript: SimulationTranscript,
  assertion: SimulationAssertion,
): GradeResult {
  switch (assertion.kind) {
    case "tool_called": {
      const calls = findCalls(transcript, assertion.tool);
      if (calls.length === 0) {
        return fail(`expected '${assertion.tool}' to be called at least once, but it never was`);
      }
      if (assertion.withFields) {
        const missing = assertion.withFields.filter(
          (field) => !calls.some((c) => Object.hasOwn(c.arguments, field)),
        );
        if (missing.length > 0) {
          return fail(
            `'${assertion.tool}' was called, but no call included required field(s): ${missing.join(", ")}`,
          );
        }
      }
      if (assertion.withoutFields) {
        const leaked = assertion.withoutFields.filter((field) =>
          calls.some((c) => Object.hasOwn(c.arguments, field)),
        );
        if (leaked.length > 0) {
          return fail(
            `'${assertion.tool}' was called WITH forbidden field(s): ${leaked.join(", ")}`,
          );
        }
      }
      return pass(`'${assertion.tool}' was called as expected`);
    }

    case "tool_not_called": {
      const calls = findCalls(transcript, assertion.tool);
      return calls.length === 0
        ? pass(`'${assertion.tool}' was correctly never called`)
        : fail(
            `'${assertion.tool}' should never have been called, but it was called ${calls.length} time(s)`,
          );
    }

    case "tool_called_with_zero_params": {
      const calls = findCalls(transcript, assertion.tool);
      if (calls.length === 0) {
        return fail(
          `expected '${assertion.tool}' to be called with zero parameters, but it was never called`,
        );
      }
      const withParams = calls.filter((c) => Object.keys(c.arguments).length > 0);
      return withParams.length === 0
        ? pass(`'${assertion.tool}' was called with zero parameters, as required`)
        : fail(
            `'${assertion.tool}' was called with non-empty arguments (${JSON.stringify(withParams[0]?.arguments)}) — its destination must be tenant-config-only, never caller-suppliable`,
          );
    }

    case "state_reached": {
      return transcript.reachedStates.includes(assertion.state)
        ? pass(`state '${assertion.state}' was reached`)
        : fail(
            `expected state '${assertion.state}' to be reached; visited [${transcript.reachedStates.join(", ")}]`,
          );
    }

    case "state_not_reached": {
      return !transcript.reachedStates.includes(assertion.state)
        ? pass(`state '${assertion.state}' was correctly never reached`)
        : fail(`state '${assertion.state}' should never have been reached, but it was`);
    }

    case "first_utterance_contains": {
      const first = transcript.firstAgentUtterance ?? "";
      return first.toLowerCase().includes(assertion.text.toLowerCase())
        ? pass(`first agent utterance contained "${assertion.text}"`)
        : fail(
            `first agent utterance did not contain "${assertion.text}" — got: ${JSON.stringify(first)}`,
          );
    }

    case "agent_never_says": {
      const lines =
        transcript.agentUtterances ??
        (transcript.firstAgentUtterance ? [transcript.firstAgentUtterance] : []);
      const offending = lines.find((line) =>
        line.toLowerCase().includes(assertion.text.toLowerCase()),
      );
      return offending === undefined
        ? pass(`the agent never said "${assertion.text}"`)
        : fail(`the agent said "${assertion.text}" at least once: ${JSON.stringify(offending)}`);
    }

    case "no_forbidden_fields": {
      const leaks: string[] = [];
      for (const call of transcript.toolCalls) {
        for (const field of assertion.fields) {
          if (containsKeyDeep(call.arguments, field)) {
            leaks.push(`${call.name}.${field}`);
          }
        }
      }
      return leaks.length === 0
        ? pass(`no tool call carried any of [${assertion.fields.join(", ")}]`)
        : fail(`forbidden field(s) leaked into a tool call: ${leaks.join(", ")}`);
    }

    case "all": {
      const results = assertion.of.map((a) => gradeTranscript(transcript, a));
      const failed = results.find((r) => !r.pass && !r.needsReview);
      if (failed) return fail(failed.reason);
      const review = results.find((r) => r.needsReview);
      if (review) return { pass: true, needsReview: true, reason: review.reason };
      return pass(results.map((r) => r.reason).join("; "));
    }

    case "any": {
      const results = assertion.of.map((a) => gradeTranscript(transcript, a));
      const succeeded = results.find((r) => r.pass);
      if (succeeded) return pass(succeeded.reason);
      return fail(
        `none of ${results.length} alternatives passed: ${results.map((r) => r.reason).join(" | ")}`,
      );
    }

    case "manual_review": {
      return { pass: true, needsReview: true, reason: assertion.reason };
    }
  }
}

function containsKeyDeep(value: unknown, key: string): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsKeyDeep(item, key));
  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, key)) return true;
  return Object.values(record).some((v) => containsKeyDeep(v, key));
}
