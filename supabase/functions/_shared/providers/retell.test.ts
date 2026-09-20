import { describe, expect, it } from "vitest";
import {
  createBatchTest,
  createChat,
  createChatCompletion,
  createPhoneCall,
  createTestCaseDefinition,
  listPhoneNumbers,
  listTestRuns,
  updatePhoneNumber,
} from "./retell.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createPhoneCall (outbound calling, G1/G2 disclosure enforcement)", () => {
  it("refuses to call Retell at all when disclosure_line is missing", async () => {
    const fetchImpl = async () => {
      throw new Error("should never be called");
    };
    const result = await createPhoneCall(fetchImpl, "key", {
      from_number: "+15550001111",
      to_number: "+15550002222",
      override_agent_id: "agent_1",
      retell_llm_dynamic_variables: { disclosure_line: "" },
    });
    expect(result.ok).toBe(false);
    expect(result.body).toEqual({ error: "disclosure_line_missing_refusing_to_call" });
  });

  it("refuses when disclosure_line is only whitespace", async () => {
    const fetchImpl = async () => {
      throw new Error("should never be called");
    };
    const result = await createPhoneCall(fetchImpl, "key", {
      from_number: "+15550001111",
      to_number: "+15550002222",
      override_agent_id: "agent_1",
      retell_llm_dynamic_variables: { disclosure_line: "   " },
    });
    expect(result.ok).toBe(false);
  });

  it("posts to /v2/create-phone-call with the confirmed shape when disclosure_line is present", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return jsonResponse({ call_id: "call_123" }, 201);
    };
    const result = await createPhoneCall(fetchImpl, "key", {
      from_number: "+15550001111",
      to_number: "+15550002222",
      override_agent_id: "agent_1",
      retell_llm_dynamic_variables: { disclosure_line: "This call may be recorded by AI." },
      metadata: { consent_ref: "lcr_1" },
    });
    expect(capturedUrl).toBe("https://api.retellai.com/v2/create-phone-call");
    expect(capturedBody).toEqual({
      from_number: "+15550001111",
      to_number: "+15550002222",
      override_agent_id: "agent_1",
      retell_llm_dynamic_variables: { disclosure_line: "This call may be recorded by AI." },
      metadata: { consent_ref: "lcr_1" },
    });
    expect(result.ok).toBe(true);
    expect((result.body as { call_id: string }).call_id).toBe("call_123");
  });

  it("propagates a non-2xx Retell response as ok:false", async () => {
    const fetchImpl = async () => jsonResponse({ error: "bad_request" }, 400);
    const result = await createPhoneCall(fetchImpl, "key", {
      from_number: "+15550001111",
      to_number: "+15550002222",
      override_agent_id: "agent_1",
      retell_llm_dynamic_variables: { disclosure_line: "disclosed" },
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });
});

describe("listPhoneNumbers", () => {
  it("GETs /v2/list-phone-numbers with a limit query param", async () => {
    let capturedUrl: string | undefined;
    const fetchImpl = async (url: string) => {
      capturedUrl = url;
      return jsonResponse([{ phone_number: "+14155551234", inbound_agents: [] }]);
    };
    const result = await listPhoneNumbers(fetchImpl, "key", 50);
    expect(capturedUrl).toBe("https://api.retellai.com/v2/list-phone-numbers?limit=50");
    expect(result.ok).toBe(true);
  });

  it("defaults limit to 1000 when omitted", async () => {
    let capturedUrl: string | undefined;
    const fetchImpl = async (url: string) => {
      capturedUrl = url;
      return jsonResponse([]);
    };
    await listPhoneNumbers(fetchImpl, "key");
    expect(capturedUrl).toBe("https://api.retellai.com/v2/list-phone-numbers?limit=1000");
  });
});

describe("updatePhoneNumber", () => {
  it("PATCHes /update-phone-number/{phone_number} with the weighted inbound_agents shape", async () => {
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;
    let capturedBody: unknown;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init?.method;
      capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return jsonResponse({ phone_number: "+14155551234" });
    };
    const result = await updatePhoneNumber(fetchImpl, "key", "+14155551234", {
      inbound_agents: [{ agent_id: "agent_1", weight: 1 }],
      inbound_webhook_url: "https://example.com/voice-inbound",
    });
    expect(capturedUrl).toBe("https://api.retellai.com/update-phone-number/%2B14155551234");
    expect(capturedMethod).toBe("PATCH");
    expect(capturedBody).toEqual({
      inbound_agents: [{ agent_id: "agent_1", weight: 1 }],
      inbound_webhook_url: "https://example.com/voice-inbound",
    });
    expect(result.ok).toBe(true);
  });
});

describe("test-case-definition / batch-test / list-test-runs", () => {
  it("posts a test case definition to /create-test-case-definition", async () => {
    let capturedUrl: string | undefined;
    const fetchImpl = async (url: string) => {
      capturedUrl = url;
      return jsonResponse({ test_case_definition_id: "def_1" });
    };
    const result = await createTestCaseDefinition(fetchImpl, "key", {
      name: "auto:book_new_caller",
      response_engine: { type: "conversation-flow", conversation_flow_id: "flow_1" },
      user_prompt: "You are calling to book an oil change.",
      metrics: ["Agent's responses stay relevant to what the simulated caller said."],
    });
    expect(capturedUrl).toBe("https://api.retellai.com/create-test-case-definition");
    expect((result.body as { test_case_definition_id: string }).test_case_definition_id).toBe(
      "def_1",
    );
  });

  it("posts a batch test to /create-batch-test", async () => {
    const fetchImpl = async () =>
      jsonResponse({ test_case_batch_job_id: "batch_1", status: "in_progress" });
    const result = await createBatchTest(fetchImpl, "key", {
      response_engine: { type: "conversation-flow", conversation_flow_id: "flow_1" },
      test_case_definition_ids: ["def_1", "def_2"],
    });
    expect((result.body as { test_case_batch_job_id: string }).test_case_batch_job_id).toBe(
      "batch_1",
    );
  });

  it("GETs /v2/list-test-runs/{id} with a limit query param", async () => {
    let capturedUrl: string | undefined;
    const fetchImpl = async (url: string) => {
      capturedUrl = url;
      return jsonResponse({ items: [] });
    };
    await listTestRuns(fetchImpl, "key", "batch_1", 200);
    expect(capturedUrl).toBe("https://api.retellai.com/v2/list-test-runs/batch_1?limit=200");
  });
});

describe("createChat / createChatCompletion", () => {
  it("posts to /create-chat with the agent id", async () => {
    let capturedBody: unknown;
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return jsonResponse({ chat_id: "chat_1", chat_status: "ongoing" });
    };
    const result = await createChat(fetchImpl, "key", { agent_id: "agent_1" });
    expect(capturedBody).toEqual({ agent_id: "agent_1" });
    expect((result.body as { chat_id: string }).chat_id).toBe("chat_1");
  });

  it("posts to /create-chat-completion with chat_id and content", async () => {
    const fetchImpl = async () => jsonResponse({ messages: [] });
    const result = await createChatCompletion(fetchImpl, "key", {
      chat_id: "chat_1",
      content: "What are your hours?",
    });
    expect(result.ok).toBe(true);
  });
});
