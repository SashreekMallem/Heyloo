import { describe, expect, it } from "vitest";
import * as fx from "./gemini.fixtures.ts";
import {
  createGeminiClient,
  GEMINI_DEFAULT_MODEL,
  GEMINI_DEFAULT_THINKING_HEADROOM_TOKENS,
} from "./gemini.ts";
import type { LlmToolCall } from "./types.ts";

// biome-ignore lint/suspicious/noExplicitAny: recorded request bodies are untyped JSON in these tests
type Json = any;

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Json | undefined;
}

type Step = Response | Error | ((init: RequestInit) => Promise<Response>);

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Scripted transport: consumes one step per attempt and records every request. */
function scripted(steps: Step[]) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const transport = {
    fetchImpl: async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      const step = steps.shift();
      if (!step) throw new Error("no scripted response left");
      if (step instanceof Error) throw step;
      if (typeof step === "function") return step(init ?? {});
      return step;
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    random: () => 0,
  };
  return { transport, calls, sleeps };
}

function client(steps: Step[], config: Partial<Parameters<typeof createGeminiClient>[0]> = {}) {
  const s = scripted(steps);
  return {
    ...s,
    llm: createGeminiClient({ apiKey: "test-key", transport: s.transport, ...config }),
  };
}

describe("gemini adapter — request shape (ai.google.dev/api/generate-content)", () => {
  it("POSTs to v1beta/models/{model}:generateContent with the key in x-goog-api-key, never in the URL", async () => {
    const { llm, calls } = client([json(fx.GEMINI_TEXT_RESPONSE)]);
    await llm.generateText({ input: "hi", maxOutputTokens: 100 });
    expect(calls[0]?.url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DEFAULT_MODEL}:generateContent`,
    );
    expect(calls[0]?.url).not.toContain("key=");
    expect(calls[0]?.url).not.toContain("test-key");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers["x-goog-api-key"]).toBe("test-key");
    expect(calls[0]?.headers["content-type"]).toBe("application/json");
  });

  it("sends system text as systemInstruction and adds reasoning headroom to maxOutputTokens", async () => {
    const { llm, calls } = client([json(fx.GEMINI_TEXT_RESPONSE)]);
    await llm.generateText({
      input: "hi",
      system: "Be brief.",
      maxOutputTokens: 350,
      temperature: 0.2,
    });
    expect(calls[0]?.body?.["systemInstruction"]).toEqual({ parts: [{ text: "Be brief." }] });
    expect(calls[0]?.body?.["contents"]).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
    // Gemini 3+ models keep the default temperature (docs/gemini-3), so 0.2 is not sent.
    expect(calls[0]?.body?.["generationConfig"]).toEqual({
      maxOutputTokens: 350 + GEMINI_DEFAULT_THINKING_HEADROOM_TOKENS,
    });
    expect(calls[0]?.body?.["safetySettings"]).toBeUndefined();
  });

  it("sends a caller's temperature only to pre-Gemini-3 models", async () => {
    const { llm, calls } = client([json(fx.GEMINI_TEXT_RESPONSE), json(fx.GEMINI_TEXT_RESPONSE)]);
    await llm.generateText({
      input: "hi",
      maxOutputTokens: 10,
      temperature: 0,
      model: "gemini-2.5-flash",
    });
    await llm.generateText({
      input: "hi",
      maxOutputTokens: 10,
      temperature: 0,
      model: "gemini-3.8-flash",
    });
    expect(calls[0]?.body?.["generationConfig"]).toMatchObject({ temperature: 0 });
    expect(calls[1]?.body?.["generationConfig"]).not.toHaveProperty("temperature");
  });

  it("uses the tier's configured model, an explicit model override first", async () => {
    const { llm, calls } = client([json(fx.GEMINI_TEXT_RESPONSE), json(fx.GEMINI_TEXT_RESPONSE)], {
      models: { fast: "gemini-fast-x", quality: "gemini-quality-x", vision: "gemini-vision-x" },
    });
    await llm.generateText({ input: "a", maxOutputTokens: 10, tier: "quality" });
    await llm.generateText({
      input: "a",
      maxOutputTokens: 10,
      tier: "vision",
      model: "models/gemini-pinned",
    });
    expect(calls[0]?.url).toContain("/models/gemini-quality-x:generateContent");
    expect(calls[1]?.url).toContain("/models/gemini-pinned:generateContent");
    expect(llm.modelFor("fast")).toBe("gemini-fast-x");
  });

  it("sends structured output as responseMimeType application/json plus responseJsonSchema", async () => {
    const { llm, calls } = client([json(fx.GEMINI_JSON_RESPONSE)]);
    const schema = {
      type: "object",
      properties: { items: { type: "array" } },
      required: ["items"],
    };
    await llm.generateJson({ input: "menu", schema, maxOutputTokens: 100 });
    expect(calls[0]?.body?.["generationConfig"]).toMatchObject({
      responseMimeType: "application/json",
      responseJsonSchema: schema,
    });
  });

  it("sends image and PDF bytes as inlineData parts (base64), text alongside", async () => {
    const { llm, calls } = client([json(fx.GEMINI_JSON_RESPONSE)]);
    await llm.generateJson({
      tier: "vision",
      input: [
        { kind: "media", mimeType: "application/pdf", dataBase64: "JVBERi0xLjQK" },
        { kind: "media", mimeType: "image/jpeg", dataBase64: "/9j/4AAQ" },
        { kind: "text", text: "Extract the menu." },
      ],
      schema: { type: "object" },
      maxOutputTokens: 100,
    });
    expect(calls[0]?.body?.["contents"]).toEqual([
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "application/pdf", data: "JVBERi0xLjQK" } },
          { inlineData: { mimeType: "image/jpeg", data: "/9j/4AAQ" } },
          { text: "Extract the menu." },
        ],
      },
    ]);
  });

  it("declares tools as functionDeclarations with parametersJsonSchema", async () => {
    const { llm, calls } = client([json(fx.GEMINI_TEXT_RESPONSE)]);
    const inputSchema = {
      type: "object",
      properties: { party_size: { type: "integer", minimum: 1 } },
    };
    await llm.chat({
      messages: [{ role: "user", text: "hi" }],
      tools: [{ name: "check_availability", description: "Check slots.", inputSchema }],
      maxOutputTokens: 100,
    });
    expect(calls[0]?.body?.["tools"]).toEqual([
      {
        functionDeclarations: [
          {
            name: "check_availability",
            description: "Check slots.",
            parametersJsonSchema: inputSchema,
          },
        ],
      },
    ]);
  });

  it("adds explicit safetySettings for the four adjustable categories only when configured", async () => {
    const { llm, calls } = client([json(fx.GEMINI_TEXT_RESPONSE)], {
      safetyThreshold: "BLOCK_ONLY_HIGH",
    });
    await llm.generateText({ input: "hi", maxOutputTokens: 10 });
    const settings = calls[0]?.body?.["safetySettings"] as {
      category: string;
      threshold: string;
    }[];
    expect(settings.map((s) => s.category).sort()).toEqual([
      "HARM_CATEGORY_DANGEROUS_CONTENT",
      "HARM_CATEGORY_HARASSMENT",
      "HARM_CATEGORY_HATE_SPEECH",
      "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    ]);
    expect(new Set(settings.map((s) => s.threshold))).toEqual(new Set(["BLOCK_ONLY_HIGH"]));
  });
});

describe("gemini adapter — chat / tool loop conversion", () => {
  it("maps history to user/model contents, merging consecutive same-role turns", async () => {
    const { llm, calls } = client([json(fx.GEMINI_TEXT_RESPONSE)]);
    await llm.chat({
      maxOutputTokens: 50,
      messages: [
        { role: "user", text: "a" },
        { role: "user", text: "b" },
        { role: "assistant", text: "hello" },
        { role: "user", text: "c" },
      ],
    });
    expect(calls[0]?.body?.["contents"]).toEqual([
      { role: "user", parts: [{ text: "a" }, { text: "b" }] },
      { role: "model", parts: [{ text: "hello" }] },
      { role: "user", parts: [{ text: "c" }] },
    ]);
  });

  it("returns tool calls with canonical ids and an opaque state carrying the thought signature", async () => {
    const { llm } = client([json(fx.GEMINI_FUNCTION_CALL_RESPONSE)]);
    const res = await llm.chat({
      messages: [{ role: "user", text: "free tomorrow?" }],
      maxOutputTokens: 100,
    });
    if (!res.ok) throw new Error("expected ok");
    expect(res.stopReason).toBe("tool_use");
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]).toMatchObject({
      name: "check_availability",
      args: { date_range: { start: "2026-10-05", end: "2026-10-06" } },
      providerState: { thoughtSignature: "EpoGCpcGAXLI2nx-signature" },
    });
    expect(res.assistantMessage).toEqual({ role: "assistant", toolCalls: res.toolCalls });
  });

  it("echoes the model's functionCall (with its thoughtSignature) and answers with a functionResponse part", async () => {
    const first = client([json(fx.GEMINI_FUNCTION_CALL_RESPONSE)]);
    const turn1 = await first.llm.chat({
      messages: [{ role: "user", text: "free tomorrow?" }],
      maxOutputTokens: 100,
    });
    if (!turn1.ok) throw new Error("expected ok");

    const { llm, calls } = client([json(fx.GEMINI_TEXT_RESPONSE)]);
    await llm.chat({
      maxOutputTokens: 100,
      messages: [
        { role: "user", text: "free tomorrow?" },
        turn1.assistantMessage,
        {
          role: "tool",
          results: [
            {
              callId: turn1.toolCalls[0]?.id as string,
              name: "check_availability",
              content: '{"slots":[]}',
            },
          ],
        },
      ],
    });
    expect(calls[0]?.body?.["contents"]).toEqual([
      { role: "user", parts: [{ text: "free tomorrow?" }] },
      {
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
      {
        role: "user",
        parts: [
          {
            functionResponse: { name: "check_availability", response: { result: '{"slots":[]}' } },
          },
        ],
      },
    ]);
  });

  it("pairs parallel calls by the provider's own ids and reports tool errors under an error key", async () => {
    const first = client([json(fx.GEMINI_PARALLEL_CALLS_RESPONSE)]);
    const turn1 = await first.llm.chat({
      messages: [{ role: "user", text: "x" }],
      maxOutputTokens: 50,
    });
    if (!turn1.ok) throw new Error("expected ok");
    expect(turn1.toolCalls.map((c: LlmToolCall) => c.id)).toEqual(["fc-a", "fc-b"]);

    const { llm, calls } = client([json(fx.GEMINI_TEXT_RESPONSE)]);
    await llm.chat({
      maxOutputTokens: 50,
      messages: [
        { role: "user", text: "x" },
        turn1.assistantMessage,
        {
          role: "tool",
          results: [
            { callId: "fc-a", name: "list_offerings", content: "[]" },
            { callId: "fc-b", name: "check_availability", content: "boom", isError: true },
          ],
        },
      ],
    });
    const contents = calls[0]?.body?.["contents"] as {
      role: string;
      parts: Json[];
    }[];
    expect(contents[1]?.parts[0]).toMatchObject({
      functionCall: { id: "fc-a", name: "list_offerings" },
      thoughtSignature: "sig-first",
    });
    expect(contents[1]?.parts[1]?.["thoughtSignature"]).toBeUndefined();
    expect(contents[2]?.parts).toEqual([
      { functionResponse: { id: "fc-a", name: "list_offerings", response: { result: "[]" } } },
      { functionResponse: { id: "fc-b", name: "check_availability", response: { error: "boom" } } },
    ]);
  });
});

describe("gemini adapter — response parsing", () => {
  it("returns text, finish reason and usage", async () => {
    const { llm } = client([json(fx.GEMINI_TEXT_RESPONSE)]);
    const res = await llm.generateText({ input: "hi", maxOutputTokens: 50 });
    expect(res).toEqual({
      ok: true,
      text: "Happy to help you book a cleaning.",
      finishReason: "stop",
      usage: { inputTokens: 120, outputTokens: 9 },
      model: GEMINI_DEFAULT_MODEL,
    });
  });

  it("bills reasoning tokens as output and never shows thought parts as reply text", async () => {
    const { llm } = client([json(fx.GEMINI_TEXT_WITH_THOUGHTS_RESPONSE)]);
    const res = await llm.generateText({ input: "hi", maxOutputTokens: 50 });
    if (!res.ok) throw new Error("expected ok");
    expect(res.text).toBe("Sure, what day works?");
    expect(res.usage).toEqual({ inputTokens: 200, outputTokens: 6 + 41 });
  });

  it("parses structured JSON output", async () => {
    const { llm } = client([json(fx.GEMINI_JSON_RESPONSE)]);
    const res = await llm.generateJson({
      input: "m",
      schema: { type: "object" },
      maxOutputTokens: 50,
    });
    if (!res.ok) throw new Error("expected ok");
    expect(res.json).toEqual({ items: [{ name: "Margherita", price_cents: 1400 }] });
  });

  it("tolerates a fenced JSON reply", async () => {
    const fenced = {
      candidates: [
        { content: { parts: [{ text: '```json\n{"a":1}\n```' }] }, finishReason: "STOP" },
      ],
    };
    const { llm } = client([json(fenced)]);
    const res = await llm.generateJson({
      input: "m",
      schema: { type: "object" },
      maxOutputTokens: 50,
    });
    if (!res.ok) throw new Error("expected ok");
    expect(res.json).toEqual({ a: 1 });
  });

  it("classifies a prompt blocked by the safety layer", async () => {
    const { llm } = client([json(fx.GEMINI_PROMPT_BLOCKED_RESPONSE)]);
    const res = await llm.generateText({ input: "x", maxOutputTokens: 50 });
    expect(res).toMatchObject({ ok: false, error: { kind: "blocked" } });
  });

  it("classifies a candidate stopped by SAFETY as blocked", async () => {
    const { llm } = client([json(fx.GEMINI_SAFETY_STOP_RESPONSE)]);
    const res = await llm.chat({ messages: [{ role: "user", text: "x" }], maxOutputTokens: 50 });
    expect(res).toMatchObject({ ok: false, error: { kind: "blocked" } });
  });

  it("reports truncation when JSON output is cut off at the token cap", async () => {
    const { llm } = client([json(fx.GEMINI_MAX_TOKENS_RESPONSE)]);
    const res = await llm.generateJson({
      input: "m",
      schema: { type: "object" },
      maxOutputTokens: 50,
    });
    expect(res).toMatchObject({ ok: false, error: { kind: "truncated" } });
  });

  it("returns partial text with finishReason length when a text answer hits the cap", async () => {
    const capped = {
      candidates: [
        { content: { parts: [{ text: "Sure, we are open" }] }, finishReason: "MAX_TOKENS" },
      ],
    };
    const { llm } = client([json(capped)]);
    const res = await llm.generateText({ input: "hours?", maxOutputTokens: 5 });
    expect(res).toMatchObject({ ok: true, text: "Sure, we are open", finishReason: "length" });
  });

  it("treats a malformed function call as a bad response", async () => {
    const { llm } = client([json(fx.GEMINI_MALFORMED_CALL_RESPONSE)]);
    const res = await llm.chat({ messages: [{ role: "user", text: "x" }], maxOutputTokens: 50 });
    expect(res).toMatchObject({ ok: false, error: { kind: "bad_response" } });
  });

  it("validates the body at the boundary: an off-shape 200 becomes bad_response, not a crash", async () => {
    for (const body of [
      { candidates: "nope" },
      { candidates: [{ content: { parts: "x" } }] },
      [],
    ]) {
      const { llm } = client([json(body)]);
      const res = await llm.generateText({ input: "x", maxOutputTokens: 5 });
      expect(res).toMatchObject({ ok: false, error: { kind: "bad_response" } });
    }
  });

  it("treats an empty candidate list and a non-JSON 200 as bad_response", async () => {
    const empty = client([json({ candidates: [] })]);
    expect(await empty.llm.generateText({ input: "x", maxOutputTokens: 5 })).toMatchObject({
      ok: false,
      error: { kind: "bad_response" },
    });
    const notJson = client([new Response("<html>", { status: 200 })]);
    expect(await notJson.llm.generateText({ input: "x", maxOutputTokens: 5 })).toMatchObject({
      ok: false,
      error: { kind: "bad_response" },
    });
  });
});

describe("gemini adapter — errors, retries, timeouts (ai.google.dev/gemini-api/docs/troubleshooting)", () => {
  it("retries a 429 with backoff and then succeeds", async () => {
    const { llm, calls, sleeps } = client([
      json(fx.GEMINI_RATE_LIMIT_ERROR, 429),
      json(fx.GEMINI_TEXT_RESPONSE),
    ]);
    const res = await llm.generateText({ input: "x", maxOutputTokens: 5 });
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([500]);
  });

  it("backs off exponentially on repeated 503s and gives up after maxRetries", async () => {
    const { llm, calls, sleeps } = client([
      json(fx.GEMINI_UNAVAILABLE_ERROR, 503),
      json(fx.GEMINI_UNAVAILABLE_ERROR, 503),
      json(fx.GEMINI_UNAVAILABLE_ERROR, 503),
    ]);
    const res = await llm.generateText({ input: "x", maxOutputTokens: 5, maxRetries: 2 });
    expect(res).toMatchObject({
      ok: false,
      error: { kind: "unavailable", status: 503, retryable: true },
    });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("honors a Retry-After header (capped) instead of the default backoff", async () => {
    const { llm, sleeps } = client([
      json(fx.GEMINI_RATE_LIMIT_ERROR, 429, { "retry-after": "2" }),
      json(fx.GEMINI_TEXT_RESPONSE),
    ]);
    await llm.generateText({ input: "x", maxOutputTokens: 5 });
    expect(sleeps).toEqual([2000]);
  });

  it("never retries a 400 and classifies a bad key as auth", async () => {
    const { llm, calls } = client([json(fx.GEMINI_BAD_KEY_ERROR, 400)]);
    const res = await llm.generateText({ input: "x", maxOutputTokens: 5 });
    expect(res).toMatchObject({
      ok: false,
      error: { kind: "auth", status: 400, retryable: false },
    });
    expect(calls).toHaveLength(1);
  });

  it("classifies other 400s as invalid_request, 403 as auth, 402 as payment, 404 as invalid_request", async () => {
    const cases: [number, unknown, string][] = [
      [400, fx.GEMINI_INVALID_ARGUMENT_ERROR, "invalid_request"],
      [403, { error: { code: 403, message: "denied", status: "PERMISSION_DENIED" } }, "auth"],
      [402, { error: { code: "payment_required", message: "no credit" } }, "payment"],
      [404, fx.GEMINI_MODEL_NOT_FOUND_ERROR, "invalid_request"],
    ];
    for (const [status, body, kind] of cases) {
      const { llm, calls } = client([json(body, status)]);
      const res = await llm.generateText({ input: "x", maxOutputTokens: 5 });
      expect(res).toMatchObject({ ok: false, error: { kind, status, retryable: false } });
      expect(calls).toHaveLength(1);
    }
  });

  it("surfaces the provider message (never the key) on failure", async () => {
    const { llm } = client([json(fx.GEMINI_INVALID_ARGUMENT_ERROR, 400)]);
    const res = await llm.generateText({ input: "x", maxOutputTokens: 5 });
    if (res.ok) throw new Error("expected failure");
    expect(res.error.message).toContain("Invalid JSON payload");
    expect(JSON.stringify(res.error)).not.toContain("test-key");
  });

  it("retries a network failure and reports unavailable when it persists", async () => {
    const { llm, calls } = client([new Error("ECONNRESET"), new Error("ECONNRESET")]);
    const res = await llm.generateText({ input: "x", maxOutputTokens: 5, maxRetries: 1 });
    expect(res).toMatchObject({ ok: false, error: { kind: "unavailable", status: 0 } });
    expect(calls).toHaveLength(2);
  });

  it("aborts an attempt that exceeds timeoutMs and reports a retryable timeout", async () => {
    const hang = (init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const { llm, calls } = client([hang, hang]);
    const res = await llm.generateText({
      input: "x",
      maxOutputTokens: 5,
      timeoutMs: 15,
      maxRetries: 1,
    });
    expect(res).toMatchObject({
      ok: false,
      error: { kind: "timeout", status: 0, retryable: true },
    });
    expect(calls).toHaveLength(2);
  });

  it("never throws: every failure arm is a value", async () => {
    const { llm } = client([new Error("boom")]);
    await expect(
      llm.generateText({ input: "x", maxOutputTokens: 5, maxRetries: 0 }),
    ).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("gemini adapter — Batch API (ai.google.dev/gemini-api/docs/batch-api)", () => {
  const requests = [
    { key: "lead-1", input: "Company: Acme", system: "Summarize.", maxOutputTokens: 300 },
    { key: "lead-2", input: "Company: Beta", maxOutputTokens: 300 },
  ];

  it("submits inline requests keyed by metadata.key and returns the batch name", async () => {
    const { llm, calls } = client([json(fx.GEMINI_BATCH_CREATE_RESPONSE)]);
    const res = await llm.batch.submit({ requests });
    expect(res).toEqual({ ok: true, batchId: "batches/123456789" });
    expect(calls[0]?.url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DEFAULT_MODEL}:batchGenerateContent`,
    );
    expect(calls[0]?.headers["x-goog-api-key"]).toBe("test-key");
    const inline = calls[0]?.body?.["batch"].input_config.requests.requests;
    expect(inline).toHaveLength(2);
    expect(inline[0].metadata).toEqual({ key: "lead-1" });
    expect(inline[0].request.systemInstruction).toEqual({ parts: [{ text: "Summarize." }] });
    expect(inline[0].request.contents).toEqual([
      { role: "user", parts: [{ text: "Company: Acme" }] },
    ]);
    expect(inline[1].request.systemInstruction).toBeUndefined();
  });

  it("rejects a create response without a batch name", async () => {
    const { llm } = client([json({ metadata: {} })]);
    expect(await llm.batch.submit({ requests })).toMatchObject({
      ok: false,
      error: { kind: "bad_response" },
    });
  });

  it("polls a running batch as in_progress", async () => {
    const { llm, calls } = client([json(fx.GEMINI_BATCH_RUNNING)]);
    expect(await llm.batch.get("batches/123456789")).toEqual({
      ok: true,
      status: { state: "in_progress" },
    });
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/batches/123456789",
    );
  });

  it("maps a succeeded batch's inline responses by key; errored and blocked items become null", async () => {
    const { llm } = client([json(fx.GEMINI_BATCH_SUCCEEDED_GUIDE_SHAPE)]);
    const res = await llm.batch.get("batches/123456789");
    expect(res).toEqual({
      ok: true,
      status: {
        state: "succeeded",
        results: [
          { key: "lead-1", text: "Acme repairs cars." },
          { key: "lead-2", text: null },
          { key: "lead-3", text: null },
        ],
      },
    });
  });

  it("also reads the API-reference shape (state + output.inlinedResponses.inlinedResponses)", async () => {
    const { llm } = client([json(fx.GEMINI_BATCH_SUCCEEDED_REFERENCE_SHAPE)]);
    expect(await llm.batch.get("batches/123456789")).toEqual({
      ok: true,
      status: { state: "succeeded", results: [{ key: "lead-1", text: "Acme repairs cars." }] },
    });
  });

  it("reports an expired/failed/cancelled batch as failed with a reason", async () => {
    const { llm } = client([json(fx.GEMINI_BATCH_EXPIRED)]);
    expect(await llm.batch.get("batches/123456789")).toEqual({
      ok: true,
      status: { state: "failed", reason: "JOB_STATE_EXPIRED" },
    });
  });

  it("refuses (bad_response) results delivered as a file rather than guessing", async () => {
    const { llm } = client([json(fx.GEMINI_BATCH_RESPONSES_FILE)]);
    expect(await llm.batch.get("batches/123456789")).toMatchObject({
      ok: false,
      error: { kind: "bad_response" },
    });
  });

  it("refuses a batch id that is not a Gemini batch name, without calling the network", async () => {
    const { llm, calls } = client([]);
    expect(await llm.batch.get("msgbatch_abc")).toMatchObject({
      ok: false,
      error: { kind: "invalid_request" },
    });
    expect(await llm.batch.get("batches/../../etc")).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });
});
