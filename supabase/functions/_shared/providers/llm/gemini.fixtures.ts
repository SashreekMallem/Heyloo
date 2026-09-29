/**
 * Recorded-shape fixtures for the Gemini adapter tests: response bodies written
 * to the documented shapes of `models.generateContent` and the Batch API
 * (ai.google.dev/api/generate-content, ai.google.dev/api/batch-mode,
 * ai.google.dev/gemini-api/docs/batch-api, fetched 2026-09-29) — not captured
 * from a live call (no Gemini key exists in this build environment; the first
 * live call is a docs/VERIFY.md item). Test-only.
 */

export const GEMINI_TEXT_RESPONSE = {
  candidates: [
    {
      content: { role: "model", parts: [{ text: "Happy to help you book a cleaning." }] },
      finishReason: "STOP",
      index: 0,
    },
  ],
  usageMetadata: {
    promptTokenCount: 120,
    candidatesTokenCount: 9,
    totalTokenCount: 129,
    promptTokensDetails: [{ modality: "TEXT", tokenCount: 120 }],
  },
  modelVersion: "gemini-3.5-flash-lite",
  responseId: "resp-1",
};

/** Reasoning tokens are reported separately and billed as output. */
export const GEMINI_TEXT_WITH_THOUGHTS_RESPONSE = {
  candidates: [
    {
      content: {
        role: "model",
        parts: [
          { text: "Considering the request...", thought: true },
          { text: "Sure, what day works?" },
        ],
      },
      finishReason: "STOP",
      index: 0,
    },
  ],
  usageMetadata: {
    promptTokenCount: 200,
    candidatesTokenCount: 6,
    thoughtsTokenCount: 41,
    totalTokenCount: 247,
  },
};

export const GEMINI_JSON_RESPONSE = {
  candidates: [
    {
      content: {
        role: "model",
        parts: [{ text: '{"items":[{"name":"Margherita","price_cents":1400}]}' }],
      },
      finishReason: "STOP",
      index: 0,
    },
  ],
  usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 22, totalTokenCount: 822 },
};

export const GEMINI_FUNCTION_CALL_RESPONSE = {
  candidates: [
    {
      content: {
        role: "model",
        parts: [
          {
            functionCall: {
              name: "check_availability",
              args: { date_range: { start: "2026-10-05", end: "2026-10-06" } },
            },
            thoughtSignature: "EpoGCpcGAXLI2nx-signature",
          },
        ],
      },
      finishReason: "STOP",
      index: 0,
    },
  ],
  usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 30, totalTokenCount: 330 },
};

/** Two parallel calls; the signature rides only the first (documented behavior). */
export const GEMINI_PARALLEL_CALLS_RESPONSE = {
  candidates: [
    {
      content: {
        role: "model",
        parts: [
          {
            functionCall: { id: "fc-a", name: "list_offerings", args: {} },
            thoughtSignature: "sig-first",
          },
          { functionCall: { id: "fc-b", name: "check_availability", args: { party_size: 2 } } },
        ],
      },
      finishReason: "STOP",
    },
  ],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
};

export const GEMINI_PROMPT_BLOCKED_RESPONSE = {
  promptFeedback: { blockReason: "SAFETY", safetyRatings: [] },
  usageMetadata: { promptTokenCount: 8, totalTokenCount: 8 },
};

export const GEMINI_SAFETY_STOP_RESPONSE = {
  candidates: [{ finishReason: "SAFETY", index: 0 }],
  usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 0, totalTokenCount: 8 },
};

export const GEMINI_MAX_TOKENS_RESPONSE = {
  candidates: [
    {
      content: { role: "model", parts: [{ text: '{"items":[{"name":"Marg' }] },
      finishReason: "MAX_TOKENS",
      index: 0,
    },
  ],
  usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 4096, totalTokenCount: 4896 },
};

export const GEMINI_MALFORMED_CALL_RESPONSE = {
  candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL", index: 0 }],
};

export const GEMINI_RATE_LIMIT_ERROR = {
  error: {
    code: 429,
    message: "Resource has been exhausted (e.g. check quota).",
    status: "RESOURCE_EXHAUSTED",
  },
};

export const GEMINI_BAD_KEY_ERROR = {
  error: {
    code: 400,
    message: "API key not valid. Please pass a valid API key.",
    status: "INVALID_ARGUMENT",
  },
};

export const GEMINI_INVALID_ARGUMENT_ERROR = {
  error: {
    code: 400,
    message: "Invalid JSON payload received. Unknown name 'bogus' at 'generation_config'.",
    status: "INVALID_ARGUMENT",
  },
};

export const GEMINI_UNAVAILABLE_ERROR = {
  error: { code: 503, message: "The model is overloaded.", status: "UNAVAILABLE" },
};

export const GEMINI_MODEL_NOT_FOUND_ERROR = {
  error: { code: 404, message: "models/gemini-9 is not found.", status: "NOT_FOUND" },
};

// ---- Batch API (create returns an Operation; poll GET /v1beta/{name}) ----

export const GEMINI_BATCH_CREATE_RESPONSE = {
  name: "batches/123456789",
  metadata: {
    "@type": "type.googleapis.com/google.ai.generativelanguage.v1main.GenerateContentBatch",
    model: "models/gemini-3.5-flash-lite",
    displayName: "heyloo-test",
    state: "BATCH_STATE_PENDING",
  },
};

export const GEMINI_BATCH_RUNNING = {
  name: "batches/123456789",
  metadata: { state: "JOB_STATE_RUNNING" },
  done: false,
};

const inlinedOk = (key: string, text: string) => ({
  metadata: { key },
  response: {
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
  },
});
const inlinedErr = (key: string) => ({
  metadata: { key },
  error: { code: 500, message: "internal" },
});

/** Shape used by the batch guide's REST example: `.response.inlinedResponses`. */
export const GEMINI_BATCH_SUCCEEDED_GUIDE_SHAPE = {
  name: "batches/123456789",
  metadata: { state: "JOB_STATE_SUCCEEDED" },
  done: true,
  response: {
    inlinedResponses: [
      inlinedOk("lead-1", "Acme repairs cars."),
      inlinedErr("lead-2"),
      {
        metadata: { key: "lead-3" },
        response: { promptFeedback: { blockReason: "SAFETY" } },
      },
    ],
  },
};

/** Shape from the API reference: `GenerateContentBatch.output.inlinedResponses.inlinedResponses`. */
export const GEMINI_BATCH_SUCCEEDED_REFERENCE_SHAPE = {
  name: "batches/123456789",
  state: "BATCH_STATE_SUCCEEDED",
  output: { inlinedResponses: { inlinedResponses: [inlinedOk("lead-1", "Acme repairs cars.")] } },
};

export const GEMINI_BATCH_EXPIRED = {
  name: "batches/123456789",
  metadata: { state: "JOB_STATE_EXPIRED" },
  done: true,
};

export const GEMINI_BATCH_RESPONSES_FILE = {
  name: "batches/123456789",
  metadata: { state: "JOB_STATE_SUCCEEDED" },
  done: true,
  response: { responsesFile: "files/abc" },
};
