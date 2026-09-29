import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, MEMBER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});

const { GET } = await import("./route");

beforeEach(() => fake.reset());

describe("GET /api/tenant/settings/checklist", () => {
  it("401s signed out", async () => {
    expect((await GET()).status).toBe(401);
  });

  it("computes the checklist from the caller's own tenant rows", async () => {
    fake.signInAs(MEMBER);
    fake.queue("tenants:select", {
      data: {
        vertical: "auto",
        business_hours: { mon: [{ open: "08:00", close: "18:00" }], sun: [] },
        owner_test_phone: null,
        language_config: { primary: "en" },
      },
      error: null,
    });
    fake.queue("agent_configs:select", {
      data: {
        transfer_number: null,
        dynamic_variable_overrides: { delivery: { notification_email: "o@example.com" } },
        published_at: "2026-09-29T00:00:00Z",
        compiled_config: { a: "{{language}}" },
      },
      error: null,
    });
    fake.queue("offerings:select", { data: null, error: null, count: 4 });
    fake.queue("resources:select", { data: null, error: null, count: 0 });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; done: boolean }>;
      requiredTotal: number;
      requiredDone: number;
    };
    const done = Object.fromEntries(body.items.map((i) => [i.id, i.done]));
    expect(done).toEqual({
      transfer_number: false,
      business_hours: true,
      services: true,
      resources: false,
      notification_recipients: true,
      published: true,
      owner_test_phone: false,
    });
    expect(body.requiredTotal).toBe(6);
    expect(body.requiredDone).toBe(4);
    for (const table of ["offerings", "resources", "agent_configs"]) {
      expect(fake.callsTo(table)[0]?.filters).toContainEqual(["eq", "tenant_id", "t1"]);
    }
  });
});
