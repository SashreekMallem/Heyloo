import { describe, expect, it } from "vitest";
import {
  classifyUrl,
  collectUrls,
  describeBeginMessage,
  describeLanguage,
  describeStartNode,
  expectedUrlForField,
  functionNameOf,
  redactUrl,
  redactUrlOrNull,
  redactUrlsInText,
} from "./retell-summaries.ts";

const PROJECT_HOST = "qulcubtwqsqgqpfgvorn.supabase.co";
const BASE = `https://${PROJECT_HOST}/functions/v1`;
const EXPECTED = {
  voice_events: `${BASE}/voice-events`,
  voice_tools: `${BASE}/voice-tools`,
  voice_inbound: `${BASE}/voice-inbound`,
};

describe("redactUrl", () => {
  it("strips credentials, query values and fragments but keeps the path readable", () => {
    expect(redactUrl("https://user:pw@example.com/hook?token=abc&x=1#frag")).toBe(
      "https://REDACTED@example.com/hook?token=REDACTED&x=REDACTED",
    );
  });

  it("leaves a plain URL and {{dynamic}} placeholders untouched", () => {
    expect(redactUrl(`${BASE}/voice-tools`)).toBe(`${BASE}/voice-tools`);
    expect(redactUrl("https://example.com/{{tenant}}/hook")).toBe(
      "https://example.com/{{tenant}}/hook",
    );
  });
});

describe("redactUrl: credential-bearing paths (RETELLCFG-REVIEW)", () => {
  it("redacts capability tokens embedded in the path of a non-Supabase URL", () => {
    expect(redactUrl("https://hooks.zapier.com/hooks/catch/123456/abc9def0ghi1jkl2/")).toBe(
      "https://hooks.zapier.com/hooks/catch/123456/REDACTED/",
    );
    expect(
      redactUrl("https://hooks.slack.com/services/T0000000/B0000000/XXXXXXXXXXXXXXXXXXXXXXXX1"),
    ).toBe("https://hooks.slack.com/services/T0000000/B0000000/REDACTED");
    expect(
      redactUrl("https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/x"),
    ).toBe("https://api.telegram.org/REDACTED/x");
    expect(
      redactUrl("HTTPS://acme.app.n8n.cloud/webhook/8f14e45f-ceea-467a-9575-6b2e1c3a9d0f"),
    ).toBe("HTTPS://acme.app.n8n.cloud/webhook/REDACTED");
  });

  it("keeps ordinary paths and every Supabase function path verbatim", () => {
    expect(redactUrl("https://api.example.com/v1/bookings/create")).toBe(
      "https://api.example.com/v1/bookings/create",
    );
    expect(redactUrl(`${BASE}/api-admin-attach-retell-number`)).toBe(
      `${BASE}/api-admin-attach-retell-number`,
    );
    expect(redactUrl(`https://${PROJECT_HOST}/functions/v1/worker2024recordingfetch`)).toBe(
      `https://${PROJECT_HOST}/functions/v1/worker2024recordingfetch`,
    );
  });

  it("redacts every URL inside free text and nullable fields", () => {
    expect(
      redactUrlsInText("Call us. Pay at https://pay.example.com/i?t=secret1, or https://x.io/a."),
    ).toBe("Call us. Pay at https://pay.example.com/i?t=REDACTED, or https://x.io/a.");
    expect(redactUrlOrNull(null)).toBeNull();
    expect(redactUrlOrNull(undefined)).toBeNull();
    expect(redactUrlOrNull("https://u:p@h.example/x")).toBe("https://REDACTED@h.example/x");
    expect(describeBeginMessage({ begin_message: "Visit https://a.example/?k=v" })).toBe(
      "Visit https://a.example/?k=REDACTED",
    );
  });
});

describe("collectUrls", () => {
  it("finds whole-string and embedded URLs with their JSON path, never descending into headers/query_params", () => {
    const found = collectUrls({
      webhook_url: `${BASE}/retell-assistant`,
      tools: [
        {
          name: "t",
          url: `${BASE}/voice-tools?secret=s3cr3t`,
          headers: {
            Authorization: "Bearer sk_live_x",
            "X-Callback": "https://leak.example/secret",
          },
          query_params: { key: "https://leak.example/also-secret" },
        },
      ],
      general_prompt: "Tell callers to visit https://acme.example/book. Thanks.",
      sip_trunk_auth_password: "https://never.example",
    });
    expect(found).toEqual([
      { path: "webhook_url", url: `${BASE}/retell-assistant` },
      { path: "tools[0].url", url: `${BASE}/voice-tools?secret=REDACTED` },
      { path: "general_prompt", url: "https://acme.example/book" },
    ]);
    expect(JSON.stringify(found)).not.toContain("sk_live_x");
    expect(JSON.stringify(found)).not.toContain("leak.example");
  });
});

describe("classifyUrl", () => {
  const classify = (url: string, expectedForField: string | null = null) =>
    classifyUrl(url, { projectHost: PROJECT_HOST, expected: EXPECTED, expectedForField });

  it("flags the deleted legacy retell-assistant function (the VERIFY-DEPLOY 404 target)", () => {
    expect(classify(`${BASE}/retell-assistant`, EXPECTED.voice_events)).toEqual({
      classification: "legacy_function",
      function_name: "retell-assistant",
    });
  });

  it("accepts the configured endpoint for the field, ignoring trailing slashes and query", () => {
    expect(classify(`${BASE}/voice-events/`, EXPECTED.voice_events).classification).toBe(
      "expected",
    );
    expect(classify(`${BASE}/voice-tools?x=REDACTED`, EXPECTED.voice_tools).classification).toBe(
      "expected",
    );
  });

  it("flags a current function used for the wrong field", () => {
    expect(classify(`${BASE}/voice-events`, EXPECTED.voice_tools).classification).toBe(
      "current_function_wrong_field",
    );
  });

  it("flags a function on this project that is not a Retell-facing endpoint", () => {
    expect(classify(`${BASE}/retell-webhook-v2`, EXPECTED.voice_events)).toEqual({
      classification: "unexpected_project_function",
      function_name: "retell-webhook-v2",
    });
    expect(classify(`${BASE}/something-else`).classification).toBe("unexpected_project_function");
  });

  it("flags another Supabase project and treats other hosts as external", () => {
    expect(classify("https://otherref.supabase.co/functions/v1/voice-events").classification).toBe(
      "other_supabase_project",
    );
    expect(classify("https://hooks.example.com/x").classification).toBe("external");
  });
});

describe("functionNameOf / expectedUrlForField", () => {
  it("extracts the function name only for this project's functions path", () => {
    expect(functionNameOf(`${BASE}/voice-inbound`, PROJECT_HOST)).toBe("voice-inbound");
    expect(functionNameOf(`https://${PROJECT_HOST}/rest/v1/x`, PROJECT_HOST)).toBeNull();
    expect(functionNameOf("https://example.com/functions/v1/x", PROJECT_HOST)).toBeNull();
  });

  it("maps each platform-owned field to its endpoint and leaves everything else unconstrained", () => {
    expect(expectedUrlForField("agent", "webhook_url", EXPECTED)).toBe(EXPECTED.voice_events);
    expect(expectedUrlForField("phone_number", "inbound_webhook_url", EXPECTED)).toBe(
      EXPECTED.voice_inbound,
    );
    expect(expectedUrlForField("conversation_flow", "tools[3].url", EXPECTED)).toBe(
      EXPECTED.voice_tools,
    );
    expect(expectedUrlForField("retell_llm", "general_tools[0].url", EXPECTED)).toBe(
      EXPECTED.voice_tools,
    );
    expect(expectedUrlForField("retell_llm", "states[1].tools[0].url", EXPECTED)).toBe(
      EXPECTED.voice_tools,
    );
    expect(expectedUrlForField("retell_llm", "mcps[0].url", EXPECTED)).toBeNull();
    expect(expectedUrlForField("phone_number", "inbound_sms_webhook_url", EXPECTED)).toBeNull();
  });
});

describe("opening / language descriptors", () => {
  it("describes the start node, and a start_node_id that matches no node", () => {
    expect(
      describeStartNode({
        start_node_id: "a",
        nodes: [
          { id: "a", type: "conversation", instruction: { type: "static_text", text: "Hi" } },
        ],
      }),
    ).toEqual({
      id: "a",
      type: "conversation",
      instruction_type: "static_text",
      instruction_text: "Hi",
    });
    expect(describeStartNode({ start_node_id: "missing", nodes: [] })).toEqual({
      id: "missing",
      type: null,
      instruction_type: null,
      instruction_text: null,
    });
    expect(describeStartNode({ nodes: [] })).toBeNull();
    expect(describeStartNode(null)).toBeNull();
  });

  it("truncates a very long opening text", () => {
    const text = "x".repeat(5000);
    const node = describeStartNode({
      start_node_id: "a",
      nodes: [{ id: "a", instruction: { type: "prompt", text } }],
    });
    expect(node?.instruction_text?.length).toBeLessThan(2100);
    expect(node?.instruction_text?.endsWith("[truncated]")).toBe(true);
  });

  it("keeps an empty begin_message (agent waits for the caller) distinct from unset", () => {
    expect(describeBeginMessage({ begin_message: "" })).toBe("");
    expect(describeBeginMessage({})).toBeNull();
  });

  it("reads a scalar or array language and rejects anything else", () => {
    expect(describeLanguage({ language: "en-US" })).toBe("en-US");
    expect(describeLanguage({ language: ["en-US", "es-419"] })).toEqual(["en-US", "es-419"]);
    expect(describeLanguage({ language: 3 })).toBeNull();
    expect(describeLanguage({})).toBeNull();
  });
});
