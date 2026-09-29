import { describe, expect, it } from "vitest";
import { createAnthropicClient } from "./anthropic.ts";
import { createGeminiClient } from "./gemini.ts";
import type { LlmClient } from "./types.ts";

/**
 * Port contract: the SAME behavioral assertions run against every adapter
 * (docs/design/LLM_PROVIDERS.md). Each `Wire` only knows how its vendor spells
 * a scenario on the wire; the expectations are written purely in canonical
 * terms, so an adapter that drifts from the port fails here.
 */

interface Wire {
  name: "gemini" | "anthropic";
  text(text: string, usage: { input: number; output: number }): Response;
  jsonText(obj: unknown): Response;
  emptyText(): Response;
  toolCall(name: string, args: Record<string, unknown>): Response;
  blocked(): Response;
  httpError(status: number): Response;
  offShape(): Response;
  batchId: string;
  batchCreated(): Response;
  batchRunning(): Response[];
  batchDone(results: { key: string; text: string | null }[]): Response[];
}

const j = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const geminiWire: Wire = {
  name: "gemini",
  text: (text, u) =>
    j({
      candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: u.input, candidatesTokenCount: u.output },
    }),
  jsonText: (obj) =>
    j({
      candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: "STOP" }],
    }),
  emptyText: () =>
    j({ candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }] }),
  toolCall: (name, args) =>
    j({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ functionCall: { name, args }, thoughtSignature: "sig" }],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    }),
  blocked: () => j({ promptFeedback: { blockReason: "SAFETY" } }),
  httpError: (status) =>
    j({ error: { code: status, message: `error ${status}`, status: "X" } }, status),
  offShape: () => j({ candidates: "nope" }),
  batchId: "batches/42",
  batchCreated: () => j({ name: "batches/42" }),
  batchRunning: () => [
    j({ name: "batches/42", metadata: { state: "JOB_STATE_RUNNING" }, done: false }),
  ],
  batchDone: (results) => [
    j({
      name: "batches/42",
      metadata: { state: "JOB_STATE_SUCCEEDED" },
      done: true,
      response: {
        inlinedResponses: results.map((r) =>
          r.text === null
            ? { metadata: { key: r.key }, error: { code: 500, message: "x" } }
            : {
                metadata: { key: r.key },
                response: {
                  candidates: [{ content: { parts: [{ text: r.text }] }, finishReason: "STOP" }],
                },
              },
        ),
      },
    }),
  ],
};

const anthropicWire: Wire = {
  name: "anthropic",
  text: (text, u) =>
    j({
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: u.input, output_tokens: u.output },
    }),
  jsonText: (obj) =>
    j({ content: [{ type: "text", text: JSON.stringify(obj) }], stop_reason: "end_turn" }),
  emptyText: () => j({ content: [{ type: "text", text: "" }], stop_reason: "end_turn" }),
  toolCall: (name, args) =>
    j({
      content: [{ type: "tool_use", id: "toolu_1", name, input: args }],
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  blocked: () => j({ content: [{ type: "text", text: "" }], stop_reason: "refusal" }),
  httpError: (status) =>
    j({ type: "error", error: { type: "e", message: `error ${status}` } }, status),
  offShape: () => j({ content: "nope" }),
  batchId: "msgbatch_42",
  batchCreated: () => j({ id: "msgbatch_42" }),
  batchRunning: () => [j({ processing_status: "in_progress", results_url: null })],
  batchDone: (results) => [
    j({
      processing_status: "ended",
      results_url: "https://api.anthropic.com/v1/messages/batches/msgbatch_42/results",
    }),
    new Response(
      results
        .map((r) =>
          JSON.stringify({
            custom_id: r.key,
            result:
              r.text === null
                ? { type: "errored" }
                : { type: "succeeded", message: { content: [{ type: "text", text: r.text }] } },
          }),
        )
        .join("\n"),
      { status: 200 },
    ),
  ],
};

function build(wire: Wire, steps: (Response | Error)[]): { llm: LlmClient; calls: number } {
  const state = { calls: 0 };
  const transport = {
    fetchImpl: async (_url: string, init?: RequestInit) => {
      state.calls += 1;
      const step = steps.shift();
      if (!step) throw new Error("no scripted response left");
      if (step instanceof Error) throw step;
      void init;
      return step;
    },
    sleep: async () => {},
    random: () => 0,
  };
  const llm =
    wire.name === "gemini"
      ? createGeminiClient({ apiKey: "k", transport })
      : createAnthropicClient({ apiKey: "k", transport });
  return {
    llm,
    get calls() {
      return state.calls;
    },
  };
}

describe.each([geminiWire, anthropicWire])("LLM port contract — $name adapter", (wire) => {
  it("identifies itself and resolves a model id for every tier", () => {
    const { llm } = build(wire, []);
    expect(llm.provider).toBe(wire.name);
    for (const tier of ["fast", "quality", "vision"] as const) {
      expect(llm.modelFor(tier)).toEqual(expect.any(String));
      expect(llm.modelFor(tier).length).toBeGreaterThan(0);
    }
  });

  it("generateText: canonical text, stop reason, and token usage", async () => {
    const { llm } = build(wire, [wire.text("Hello!", { input: 11, output: 3 })]);
    const res = await llm.generateText({ input: "hi", maxOutputTokens: 50 });
    expect(res).toMatchObject({
      ok: true,
      text: "Hello!",
      finishReason: "stop",
      usage: { inputTokens: 11, outputTokens: 3 },
    });
  });

  it("generateJson: a parsed JSON value for text and for multimodal input", async () => {
    const payload = { items: [{ name: "Taco", price_cents: 350 }] };
    const text = build(wire, [wire.jsonText(payload)]);
    const a = await text.llm.generateJson({
      input: "menu",
      schema: { type: "object" },
      maxOutputTokens: 50,
    });
    expect(a).toMatchObject({ ok: true, json: payload });

    const media = build(wire, [wire.jsonText(payload)]);
    const b = await media.llm.generateJson({
      tier: "vision",
      input: [
        { kind: "media", mimeType: "application/pdf", dataBase64: "JVBERi0=" },
        { kind: "text", text: "extract" },
      ],
      schema: { type: "object" },
      maxOutputTokens: 50,
    });
    expect(b).toMatchObject({ ok: true, json: payload });
  });

  it("chat: a plain answer ends the turn", async () => {
    const { llm } = build(wire, [wire.text("Sure.", { input: 1, output: 1 })]);
    const res = await llm.chat({ messages: [{ role: "user", text: "hi" }], maxOutputTokens: 50 });
    expect(res).toMatchObject({ ok: true, text: "Sure.", stopReason: "end_turn", toolCalls: [] });
  });

  it("chat: a full tool-calling turn — call out, result back, final answer", async () => {
    const tools = [
      {
        name: "check_availability",
        description: "Check open slots.",
        inputSchema: { type: "object", properties: {} },
      },
    ];
    const { llm } = build(wire, [
      wire.toolCall("check_availability", { party_size: 2 }),
      wire.text("Tomorrow at 2pm is open.", { input: 5, output: 5 }),
    ]);
    const messages: Parameters<LlmClient["chat"]>[0]["messages"] = [
      { role: "user", text: "free tomorrow?" },
    ];

    const turn1 = await llm.chat({ messages, tools, maxOutputTokens: 100 });
    if (!turn1.ok) throw new Error("expected ok");
    expect(turn1.stopReason).toBe("tool_use");
    expect(turn1.toolCalls).toHaveLength(1);
    expect(turn1.toolCalls[0]).toMatchObject({
      name: "check_availability",
      args: { party_size: 2 },
    });
    expect(turn1.toolCalls[0]?.id).toEqual(expect.any(String));
    expect(turn1.assistantMessage.toolCalls).toEqual(turn1.toolCalls);

    messages.push(turn1.assistantMessage, {
      role: "tool",
      results: [
        {
          callId: turn1.toolCalls[0]?.id as string,
          name: "check_availability",
          content: '{"slots":["14:00"]}',
        },
      ],
    });
    const turn2 = await llm.chat({ messages, tools, maxOutputTokens: 100 });
    expect(turn2).toMatchObject({
      ok: true,
      text: "Tomorrow at 2pm is open.",
      stopReason: "end_turn",
    });
  });

  it("classifies transport and HTTP failures identically", async () => {
    const cases: [number, string, boolean][] = [
      [401, "auth", false],
      [403, "auth", false],
      [402, "payment", false],
      [422, "invalid_request", false],
      [500, "unavailable", true],
    ];
    for (const [status, kind, retryable] of cases) {
      const { llm } = build(wire, [
        wire.httpError(status),
        wire.httpError(status),
        wire.httpError(status),
      ]);
      const res = await llm.generateText({ input: "x", maxOutputTokens: 5, maxRetries: 0 });
      expect(res).toMatchObject({ ok: false, error: { kind, status, retryable } });
    }
  });

  it("retries 429 with backoff and reports rate_limited when it persists", async () => {
    const ok = build(wire, [wire.httpError(429), wire.text("later", { input: 1, output: 1 })]);
    expect((await ok.llm.generateText({ input: "x", maxOutputTokens: 5 })).ok).toBe(true);
    expect(ok.calls).toBe(2);

    const stuck = build(wire, [wire.httpError(429), wire.httpError(429), wire.httpError(429)]);
    const res = await stuck.llm.generateText({ input: "x", maxOutputTokens: 5, maxRetries: 2 });
    expect(res).toMatchObject({ ok: false, error: { kind: "rate_limited", retryable: true } });
    expect(stuck.calls).toBe(3);
  });

  it("does not retry a non-retryable error", async () => {
    const built = build(wire, [wire.httpError(403), wire.text("never", { input: 1, output: 1 })]);
    await built.llm.generateText({ input: "x", maxOutputTokens: 5 });
    expect(built.calls).toBe(1);
  });

  it("reports a safety block as kind blocked", async () => {
    const { llm } = build(wire, [wire.blocked()]);
    expect(await llm.generateText({ input: "x", maxOutputTokens: 5 })).toMatchObject({
      ok: false,
      error: { kind: "blocked" },
    });
  });

  it("reports an empty answer and an off-shape body as bad_response, never throwing", async () => {
    for (const bad of [wire.emptyText(), wire.offShape()]) {
      const { llm } = build(wire, [bad]);
      expect(await llm.generateText({ input: "x", maxOutputTokens: 5 })).toMatchObject({
        ok: false,
        error: { kind: "bad_response" },
      });
    }
  });

  it("turns a thrown network error into a value", async () => {
    const { llm } = build(wire, [new Error("ECONNRESET")]);
    expect(await llm.generateText({ input: "x", maxOutputTokens: 5, maxRetries: 0 })).toMatchObject(
      {
        ok: false,
        error: { kind: "unavailable" },
      },
    );
  });

  it("batch: submit, poll while running, then collect results keyed by the caller's key", async () => {
    const created = build(wire, [wire.batchCreated()]);
    const submitted = await created.llm.batch.submit({
      requests: [
        { key: "lead-1", input: "Acme", maxOutputTokens: 100 },
        { key: "lead-2", input: "Beta", maxOutputTokens: 100 },
      ],
    });
    expect(submitted).toEqual({ ok: true, batchId: wire.batchId });

    const running = build(wire, wire.batchRunning());
    expect(await running.llm.batch.get(wire.batchId)).toEqual({
      ok: true,
      status: { state: "in_progress" },
    });

    const done = build(
      wire,
      wire.batchDone([
        { key: "lead-1", text: "Acme repairs cars." },
        { key: "lead-2", text: null },
      ]),
    );
    const res = await done.llm.batch.get(wire.batchId);
    if (!res.ok || res.status.state !== "succeeded") throw new Error("expected a succeeded batch");
    const byKey = new Map(res.status.results.map((r) => [r.key, r.text]));
    expect(byKey.get("lead-1")).toBe("Acme repairs cars.");
    expect(byKey.get("lead-2")).toBeNull();
  });
});
