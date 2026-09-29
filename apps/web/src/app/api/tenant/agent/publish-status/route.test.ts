import { beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_AGENT_COMPILER_VERSION } from "@/lib/settings/publish-status";
import { fake, MEMBER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});

const { GET } = await import("./route");

beforeEach(() => fake.reset());

describe("GET /api/tenant/agent/publish-status", () => {
  it("401s signed out", async () => {
    expect((await GET()).status).toBe(401);
  });

  it("reports a pending language change to any member, reading only their own tenant", async () => {
    fake.signInAs(MEMBER);
    fake.queue("agent_configs:select", {
      data: {
        published_at: "2026-09-29T00:00:00Z",
        compiled_config: { a: "{{language}} {{transfer_number}}" },
        transfer_number: "+16105550122",
        compiled_with_version: CURRENT_AGENT_COMPILER_VERSION,
      },
      error: null,
    });
    fake.queue("tenants:select", {
      data: { language_config: { primary: "es", changed_at: "2026-09-29T05:00:00Z" } },
      error: null,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      publishedAt: "2026-09-29T00:00:00Z",
      pending: true,
      reasons: ["language_changed"],
    });
    expect(fake.callsTo("agent_configs")[0]?.filters).toContainEqual(["eq", "tenant_id", "t1"]);
    expect(fake.callsTo("tenants")[0]?.filters).toContainEqual(["eq", "id", "t1"]);
  });

  it("SETTINGS-2: flags an agent that was never stamped with a compiler version", async () => {
    fake.signInAs(MEMBER);
    fake.queue("agent_configs:select", {
      data: {
        published_at: "2026-09-29T00:00:00Z",
        compiled_config: { a: "{{language}} {{transfer_number}}" },
        transfer_number: null,
        compiled_with_version: null,
      },
      error: null,
    });
    fake.queue("tenants:select", { data: { language_config: { primary: "en" } }, error: null });
    const res = await GET();
    expect(await res.json()).toEqual({
      publishedAt: "2026-09-29T00:00:00Z",
      pending: true,
      reasons: ["compiler_outdated"],
    });
  });

  it("SETTINGS-2: a database without the stamp column yet (42703) falls back and never flags", async () => {
    fake.signInAs(MEMBER);
    fake.queue("agent_configs:select", {
      data: null,
      error: {
        code: "42703",
        message: "column agent_configs.compiled_with_version does not exist",
      },
    });
    fake.queue("agent_configs:select", {
      data: {
        published_at: "2026-09-29T00:00:00Z",
        compiled_config: { a: "{{language}}" },
        transfer_number: null,
      },
      error: null,
    });
    fake.queue("tenants:select", { data: { language_config: { primary: "en" } }, error: null });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      publishedAt: "2026-09-29T00:00:00Z",
      pending: false,
      reasons: [],
    });
  });

  it("500s on a read error", async () => {
    fake.signInAs(MEMBER);
    fake.queue("agent_configs:select", { data: null, error: { message: "down" } });
    expect((await GET()).status).toBe(500);
  });
});
