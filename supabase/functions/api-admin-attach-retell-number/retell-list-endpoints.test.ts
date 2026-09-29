import { describe, expect, it } from "vitest";
import {
  getAgentVersion,
  getChatAgentVersion,
  listAgentsPage,
  listAgentVersions,
  listConversationFlowsPage,
  listPhoneNumbersPage,
  listRetellLLMsPage,
} from "../_shared/providers/retell.ts";

/**
 * RETELLCFG: pins the exact method / path / query / auth of the read-only
 * inventory wrappers added to `_shared/providers/retell.ts`, as documented
 * on docs.retellai.com (2026-09-29) and in `retell-sdk@5.64.0`
 * (`Agent.list` = POST /v2/list-agents with limit/pagination_key/sort_order
 * as QUERY params and filters in the body; `Agent.listVersions` = GET
 * /list-agent-versions/{id}; `Llm.list` = GET /v2/list-retell-llms;
 * `ConversationFlow.list` = GET /v2/list-conversation-flows;
 * `PhoneNumber.list` = GET /v2/list-phone-numbers; `ChatAgent.retrieve` =
 * GET /get-chat-agent/{id}).
 */

function recorder() {
  const calls: { url: string; method: string; auth: string | null; body: unknown }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? "GET",
      auth: headers.get("authorization"),
      body: init?.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify({ items: [], has_more: false }), { status: 200 });
  };
  return { calls, fetchImpl };
}

describe("Retell inventory wrappers", () => {
  it("list-agents is a POST with paging in the query string and an empty filter body", async () => {
    const { calls, fetchImpl } = recorder();
    await listAgentsPage(fetchImpl, "key_1", { limit: 1000, paginationKey: "pk 1" });
    expect(calls[0]).toEqual({
      url: "https://api.retellai.com/v2/list-agents?limit=1000&pagination_key=pk+1",
      method: "POST",
      auth: "Bearer key_1",
      body: {},
    });
  });

  it("list-retell-llms / list-conversation-flows / list-phone-numbers are GETs with limit 1000 by default", async () => {
    const { calls, fetchImpl } = recorder();
    await listRetellLLMsPage(fetchImpl, "k");
    await listConversationFlowsPage(fetchImpl, "k", { paginationKey: "abc" });
    await listPhoneNumbersPage(fetchImpl, "k", { sortOrder: "ascending" });
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["GET", "https://api.retellai.com/v2/list-retell-llms?limit=1000", undefined],
      [
        "GET",
        "https://api.retellai.com/v2/list-conversation-flows?limit=1000&pagination_key=abc",
        undefined,
      ],
      [
        "GET",
        "https://api.retellai.com/v2/list-phone-numbers?limit=1000&sort_order=ascending",
        undefined,
      ],
    ]);
  });

  it("list-agent-versions, get-agent and get-chat-agent encode the id and pass the version selector", async () => {
    const { calls, fetchImpl } = recorder();
    await listAgentVersions(fetchImpl, "k", "agent/1", { limit: 1, sortOrder: "ascending" });
    await getAgentVersion(fetchImpl, "k", "agent_1", "latest_published");
    await getChatAgentVersion(fetchImpl, "k", "agent_2", 3);
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      [
        "GET",
        "https://api.retellai.com/list-agent-versions/agent%2F1?limit=1&sort_order=ascending",
      ],
      ["GET", "https://api.retellai.com/get-agent/agent_1?version=latest_published"],
      ["GET", "https://api.retellai.com/get-chat-agent/agent_2?version=3"],
    ]);
  });
});
