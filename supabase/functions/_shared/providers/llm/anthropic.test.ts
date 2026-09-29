import { describe, expect, it } from "vitest";
import { ANTHROPIC_DEFAULT_MODELS, createAnthropicClient } from "./anthropic.ts";

// biome-ignore lint/suspicious/noExplicitAny: recorded request bodies are untyped JSON in these tests
type Json = any;

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Json | undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function scripted(steps: (Response | Error)[]) {
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
      return step;
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    random: () => 0,
  };
  return { transport, calls, sleeps };
}

function client(steps: (Response | Error)[]) {
  const s = scripted(steps);
  return { ...s, llm: createAnthropicClient({ apiKey: "ak", transport: s.transport }) };
}

const TEXT = {
  content: [{ type: "text", text: "Hello there." }],
  stop_reason: "end_turn",
  usage: { input_tokens: 12, output_tokens: 4 },
};

describe("anthropic adapter (second adapter behind the LLM port)", () => {
  it("POSTs to /v1/messages with x-api-key and anthropic-version", async () => {
    const { llm, calls } = client([json(TEXT)]);
    const res = await llm.generateText({ input: "hi", system: "Be brief.", maxOutputTokens: 50 });
    expect(res).toEqual({
      ok: true,
      text: "Hello there.",
      finishReason: "stop",
      usage: { inputTokens: 12, outputTokens: 4 },
      model: ANTHROPIC_DEFAULT_MODELS.fast,
    });
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]?.headers["x-api-key"]).toBe("ak");
    expect(calls[0]?.headers["anthropic-version"]).toBe("2023-06-01");
    expect(calls[0]?.body).toMatchObject({
      model: "claude-haiku-4-5",
      max_tokens: 50,
      system: "Be brief.",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
  });

  it("maps tiers to the pre-port model ids (haiku fast, sonnet quality/vision)", () => {
    const { llm } = client([]);
    expect(llm.modelFor("fast")).toBe("claude-haiku-4-5");
    expect(llm.modelFor("quality")).toBe("claude-sonnet-5");
    expect(llm.modelFor("vision")).toBe("claude-sonnet-5");
  });

  it("requests structured JSON by embedding the schema in the system prompt and parses a fenced reply", async () => {
    const { llm, calls } = client([
      json({ ...TEXT, content: [{ type: "text", text: '```json\n{"items":[]}\n```' }] }),
    ]);
    const schema = { type: "object", properties: { items: { type: "array" } } };
    const res = await llm.generateJson({
      input: "menu",
      system: "Extract.",
      schema,
      maxOutputTokens: 50,
    });
    if (!res.ok) throw new Error("expected ok");
    expect(res.json).toEqual({ items: [] });
    expect(calls[0]?.body?.["system"]).toContain("Extract.");
    expect(calls[0]?.body?.["system"]).toContain(JSON.stringify(schema));
  });

  it("sends a PDF as a document block and an image as an image block", async () => {
    const { llm, calls } = client([json(TEXT)]);
    await llm.generateJson({
      input: [
        { kind: "media", mimeType: "application/pdf", dataBase64: "JVBERi0xLjQK" },
        { kind: "media", mimeType: "image/png", dataBase64: "iVBOR" },
        { kind: "text", text: "Extract" },
      ],
      schema: { type: "object" },
      maxOutputTokens: 50,
    });
    expect(calls[0]?.body?.["messages"][0].content).toEqual([
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQK" },
      },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" } },
      { type: "text", text: "Extract" },
    ]);
  });

  it("rejects an unsupported media type before calling the network", async () => {
    const { llm, calls } = client([]);
    const res = await llm.generateJson({
      input: [{ kind: "media", mimeType: "image/heic", dataBase64: "x" }],
      schema: { type: "object" },
      maxOutputTokens: 5,
    });
    expect(res).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
    expect(calls).toHaveLength(0);
  });

  it("round-trips tool calls: tool_use blocks in, tool_use/tool_result blocks out", async () => {
    const toolUse = {
      content: [
        { type: "tool_use", id: "toolu_1", name: "check_availability", input: { party_size: 2 } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 5, output_tokens: 5 },
    };
    const first = client([json(toolUse)]);
    const turn1 = await first.llm.chat({
      messages: [{ role: "user", text: "free?" }],
      tools: [{ name: "check_availability", description: "d", inputSchema: { type: "object" } }],
      maxOutputTokens: 50,
    });
    if (!turn1.ok) throw new Error("expected ok");
    expect(first.calls[0]?.body?.["tools"]).toEqual([
      { name: "check_availability", description: "d", input_schema: { type: "object" } },
    ]);
    expect(turn1.stopReason).toBe("tool_use");
    expect(turn1.toolCalls).toEqual([
      { id: "toolu_1", name: "check_availability", args: { party_size: 2 } },
    ]);

    const { llm, calls } = client([json(TEXT)]);
    await llm.chat({
      maxOutputTokens: 50,
      messages: [
        { role: "user", text: "free?" },
        turn1.assistantMessage,
        {
          role: "tool",
          results: [
            { callId: "toolu_1", name: "check_availability", content: "[]", isError: true },
          ],
        },
      ],
    });
    expect(calls[0]?.body?.["messages"]).toEqual([
      { role: "user", content: "free?" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "toolu_1", name: "check_availability", input: { party_size: 2 } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "[]", is_error: true }],
      },
    ]);
  });

  it("classifies refusals as blocked, 529 as a retryable unavailable, 401 as auth", async () => {
    const refusal = client([json({ ...TEXT, stop_reason: "refusal" })]);
    expect(await refusal.llm.generateText({ input: "x", maxOutputTokens: 5 })).toMatchObject({
      ok: false,
      error: { kind: "blocked" },
    });

    const overloaded = client([
      json({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, 529),
      json(TEXT),
    ]);
    expect((await overloaded.llm.generateText({ input: "x", maxOutputTokens: 5 })).ok).toBe(true);
    expect(overloaded.calls).toHaveLength(2);

    const unauth = client([
      json(
        { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
        401,
      ),
    ]);
    expect(await unauth.llm.generateText({ input: "x", maxOutputTokens: 5 })).toMatchObject({
      ok: false,
      error: { kind: "auth", status: 401 },
    });
    expect(unauth.calls).toHaveLength(1);
  });

  it("validates the body at the boundary", async () => {
    const { llm } = client([json({ content: "nope" })]);
    expect(await llm.generateText({ input: "x", maxOutputTokens: 5 })).toMatchObject({
      ok: false,
      error: { kind: "bad_response" },
    });
  });
});

describe("anthropic adapter — Message Batches", () => {
  const requests = [
    { key: "lead-1", input: "Company: Acme", system: "Summarize.", maxOutputTokens: 300 },
  ];

  it("creates a batch with custom_id = key and returns its id", async () => {
    const { llm, calls } = client([json({ id: "msgbatch_01abc", type: "message_batch" })]);
    expect(await llm.batch.submit({ requests })).toEqual({ ok: true, batchId: "msgbatch_01abc" });
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages/batches");
    expect(calls[0]?.body?.["requests"][0]).toEqual({
      custom_id: "lead-1",
      params: {
        model: "claude-haiku-4-5",
        max_tokens: 300,
        system: "Summarize.",
        messages: [{ role: "user", content: "Company: Acme" }],
      },
    });
  });

  it("reports in_progress until processing_status is ended", async () => {
    const { llm } = client([json({ processing_status: "in_progress", results_url: null })]);
    expect(await llm.batch.get("msgbatch_01abc")).toEqual({
      ok: true,
      status: { state: "in_progress" },
    });
  });

  it("collects JSONL results by custom_id in any order; non-succeeded items are null; malformed lines are skipped", async () => {
    const lines = [
      JSON.stringify({ custom_id: "lead-2", result: { type: "errored" } }),
      "not json",
      JSON.stringify({
        custom_id: "lead-1",
        result: {
          type: "succeeded",
          message: { content: [{ type: "text", text: "Acme repairs cars." }] },
        },
      }),
      JSON.stringify({ custom_id: "lead-3", result: { type: "expired" } }),
    ].join("\n");
    const { llm, calls } = client([
      json({
        processing_status: "ended",
        results_url: "https://api.anthropic.com/v1/messages/batches/msgbatch_01abc/results",
      }),
      new Response(lines, { status: 200 }),
    ]);
    const res = await llm.batch.get("msgbatch_01abc");
    expect(res).toEqual({
      ok: true,
      status: {
        state: "succeeded",
        results: [
          { key: "lead-2", text: null },
          { key: "lead-1", text: "Acme repairs cars." },
          { key: "lead-3", text: null },
        ],
      },
    });
    expect(calls[1]?.headers["x-api-key"]).toBe("ak");
  });

  it("refuses a batch id that is not an Anthropic batch id", async () => {
    const { llm, calls } = client([]);
    expect(await llm.batch.get("batches/123")).toMatchObject({
      ok: false,
      error: { kind: "invalid_request" },
    });
    expect(calls).toHaveLength(0);
  });
});
