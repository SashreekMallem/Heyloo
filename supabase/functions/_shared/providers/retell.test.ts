import { describe, expect, it } from "vitest";
import { createPhoneCall } from "./retell.ts";

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
