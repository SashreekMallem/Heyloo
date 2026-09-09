import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { ProvisionDeps } from "./handler.ts";
import { runProvisioningSaga } from "./handler.ts";

const logger = createLogger();

function makeSql(fixtures: Record<string, unknown[]> = {}): {
  sql: SqlClient;
  calls: { text: string; values: unknown[] }[];
} {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

function makeDeps(overrides: Partial<ProvisionDeps> = {}): ProvisionDeps {
  return {
    // `version` included on every Retell response — `getAgent` (called
    // before publish, RETELL-VERIFY VERIFY-6 resolved) requires it just as
    // much as `createAgent`'s own response does.
    retellFetch: (() =>
      Promise.resolve(
        new Response(JSON.stringify({ agent_id: "agent_1", llm_id: "llm_1", version: 1 }), {
          status: 200,
        }),
      )) as never,
    retellApiKey: "key",
    retellSipTerminationUri: "heyloo-trunk.pstn.twilio.com",
    retellInboundWebhookUrl: "https://example.supabase.co/functions/v1/voice-inbound",
    twilioFetch: (() =>
      Promise.resolve(
        new Response(JSON.stringify({ sid: "PN1", phone_number: "+15551230000" }), { status: 201 }),
      )) as never,
    twilioAccountSid: "AC1",
    twilioAuthToken: "token",
    compileTemplate: async () => ({ templateId: "tmpl_1", templateVersion: 1, compiledConfig: {} }),
    resolvePhoneNumberToProvision: async () => "+15551230000",
    logger,
    ...overrides,
  };
}

describe("runProvisioningSaga", () => {
  it("completes the full saga end-to-end on a fresh tenant", async () => {
    const { sql } = makeSql({
      "from public.agent_configs": [],
      "from public.phone_numbers": [],
      "returning id, e164, twilio_sid": [{ id: "pn_1", e164: "+15551230000", twilio_sid: "PN1" }],
      "select retell_number_id": [{ retell_number_id: null }],
      "insert into public.messages_outbound": [{ id: "msg_1" }],
    });
    const result = await runProvisioningSaga(sql, "tenant_1", makeDeps());
    expect(result).toEqual({ status: "complete" });
  });

  it("sends termination_uri + weighted inbound_agents on import, and {version} on publish (RETELL-VERIFY)", async () => {
    const { sql } = makeSql({
      "from public.agent_configs": [],
      "from public.phone_numbers": [],
      "returning id, e164, twilio_sid": [{ id: "pn_1", e164: "+15551230000", twilio_sid: "PN1" }],
      "select retell_number_id": [{ retell_number_id: null }],
      "insert into public.messages_outbound": [{ id: "msg_1" }],
    });
    const requests: { url: string; body: unknown }[] = [];
    const deps = makeDeps({
      retellFetch: ((url: string, init?: RequestInit) => {
        requests.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
        return Promise.resolve(
          new Response(JSON.stringify({ agent_id: "agent_1", llm_id: "llm_1", version: 1 }), {
            status: 200,
          }),
        );
      }) as never,
    });
    const result = await runProvisioningSaga(sql, "tenant_1", deps);
    expect(result).toEqual({ status: "complete" });

    const importCall = requests.find((r) => r.url.includes("import-phone-number"));
    expect(importCall?.body).toEqual({
      phone_number: "+15551230000",
      termination_uri: "heyloo-trunk.pstn.twilio.com",
      inbound_agents: [{ agent_id: "agent_1", weight: 1 }],
      inbound_webhook_url: "https://example.supabase.co/functions/v1/voice-inbound",
    });

    const publishCall = requests.find((r) => r.url.includes("publish-agent-version"));
    expect(publishCall?.body).toEqual({ version: 1 });
  });

  it("resumes past an already-compiled agent (idempotent step 2)", async () => {
    const { sql, calls } = makeSql({
      "from public.agent_configs": [
        { retell_agent_id: "agent_existing", template_id: "tmpl_1", template_version: 1 },
      ],
      "from public.phone_numbers": [{ id: "pn_1", e164: "+15551230000", twilio_sid: "PN1" }],
      "select retell_number_id": [{ retell_number_id: "retell_num_1" }],
      "insert into public.messages_outbound": [{ id: "msg_1" }],
    });
    const result = await runProvisioningSaga(sql, "tenant_1", makeDeps());
    expect(result).toEqual({ status: "complete" });
    // create-agent should never have been called since a retell_agent_id
    // already existed — verified indirectly by there being no
    // "insert into public.agent_configs" call (only reads).
    expect(calls.some((c) => c.text.includes("insert into public.agent_configs"))).toBe(false);
  });

  it("stops at twilio_number_provision and reports the failed step when Twilio purchase fails", async () => {
    const { sql } = makeSql({ "from public.agent_configs": [], "from public.phone_numbers": [] });
    const deps = makeDeps({
      twilioFetch: (() => Promise.resolve(new Response("{}", { status: 400 }))) as never,
    });
    const result = await runProvisioningSaga(sql, "tenant_1", deps);
    expect(result).toEqual({
      status: "failed",
      failedStep: "twilio_number_provision",
      error: "twilio_purchase_failed",
    });
  });

  it("flags for manual intervention (never releases the number) when Retell import fails", async () => {
    const { sql } = makeSql({
      "from public.agent_configs": [],
      "from public.phone_numbers": [{ id: "pn_1", e164: "+15551230000", twilio_sid: "PN1" }],
      "select retell_number_id": [{ retell_number_id: null }],
    });
    const deps = makeDeps({
      retellFetch: ((url: string) => {
        if (typeof url === "string" && url.includes("import-phone-number")) {
          return Promise.resolve(new Response("{}", { status: 500 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ agent_id: "agent_1" }), { status: 200 }),
        );
      }) as never,
    });
    const result = await runProvisioningSaga(sql, "tenant_1", deps);
    expect(result).toEqual({
      status: "failed",
      failedStep: "retell_number_import",
      error: "retell_import_failed",
    });
  });
});
