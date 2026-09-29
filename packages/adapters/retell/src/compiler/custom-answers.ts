/**
 * INTAKE-Q-1 (docs/BUILD_NOTES.md): the `structured_payload.custom_answers`
 * tool parameter, added at COMPILE time to the two write tools that carry the
 * owner's custom intake answers (`create_booking`, `take_message`) — kept in
 * PARITY with the live Deno compiler
 * (`supabase/functions/_shared/compiler/template-compiler.ts`,
 * `withCustomAnswersParameter`); `parity.test.ts` compares the emitted tool
 * schemas. Adding it here rather than in `packages/templates` means already-
 * seeded `agent_templates` rows need no reseed. Server-side validation
 * (`_shared/custom-questions.ts`) decides what is stored; this is only what
 * the model is shown. Nested object/array parameters are supported by Retell
 * custom functions (docs.retellai.com/build/single-multi-prompt/custom-function,
 * 2026-09-30).
 */

const CUSTOM_ANSWERS_TOOL_NAMES: ReadonlySet<string> = new Set(["create_booking", "take_message"]);

const CUSTOM_ANSWERS_PROPERTY = {
  type: "array",
  description:
    "Answers to the owner's custom intake questions (listed in your prompt under Custom " +
    "questions): one entry per question you asked, using the id shown in brackets. Never invent an answer.",
  items: {
    type: "object",
    properties: {
      question_id: { type: "string" },
      answer: {
        type: "string",
        description:
          'What the caller said, in a few words. If the caller refuses a REQUIRED question after you asked twice, use exactly "declined".',
      },
    },
    required: ["question_id", "answer"],
  },
} as const;

export interface ToolParameters {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Returns `parameters` with `structured_payload.custom_answers` added for the tools that carry it; any other tool unchanged. */
export function withCustomAnswersParameter(
  toolName: string,
  parameters: ToolParameters,
): ToolParameters {
  if (!CUSTOM_ANSWERS_TOOL_NAMES.has(toolName)) return parameters;
  const properties = objectOrEmpty(parameters.properties);
  const existing = properties["structured_payload"];
  const payload =
    existing && typeof existing === "object"
      ? (existing as Record<string, unknown>)
      : { type: "object" };
  return {
    ...parameters,
    properties: {
      ...properties,
      structured_payload: {
        ...payload,
        properties: {
          ...objectOrEmpty(payload["properties"]),
          custom_answers: CUSTOM_ANSWERS_PROPERTY,
        },
      },
    },
  };
}
