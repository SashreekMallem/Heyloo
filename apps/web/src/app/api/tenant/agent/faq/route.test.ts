import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, jsonRequest, OWNER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});

const { POST } = await import("./route");

const url = "/api/tenant/agent/faq";

beforeEach(() => fake.reset());

describe("POST /api/tenant/agent/faq", () => {
  it("422s on a blank answer", async () => {
    fake.signInAs(OWNER);
    const res = await POST(
      jsonRequest(url, { items: [{ question: "Open Sunday?", answer: " " }] }),
    );
    expect(res.status).toBe(422);
  });

  it("saves trimmed items into overrides.faq_items, keeping sibling keys", async () => {
    fake.signInAs(OWNER);
    fake.queue("agent_configs:select", {
      data: { dynamic_variable_overrides: { manager_name: "Sam" } },
      error: null,
    });
    fake.queue("agent_configs:update", { data: [{ id: "ac1" }], error: null });
    const res = await POST(
      jsonRequest(url, { items: [{ question: " Open Sunday? ", answer: " No, closed. " }] }),
    );
    expect(res.status).toBe(200);
    expect(fake.callsTo("agent_configs", "update")[0]?.payload).toEqual({
      dynamic_variable_overrides: {
        manager_name: "Sam",
        faq_items: [{ question: "Open Sunday?", answer: "No, closed." }],
      },
    });
  });

  it("an empty list removes the key", async () => {
    fake.signInAs(OWNER);
    fake.queue("agent_configs:select", {
      data: { dynamic_variable_overrides: { faq_items: [{ question: "a", answer: "b" }] } },
      error: null,
    });
    fake.queue("agent_configs:update", { data: [{ id: "ac1" }], error: null });
    await POST(jsonRequest(url, { items: [] }));
    expect(fake.callsTo("agent_configs", "update")[0]?.payload).toEqual({
      dynamic_variable_overrides: {},
    });
  });
});
