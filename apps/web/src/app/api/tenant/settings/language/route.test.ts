import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, jsonRequest, OWNER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});

const { POST } = await import("./route");

const url = "/api/tenant/settings/language";

beforeEach(() => fake.reset());

describe("POST /api/tenant/settings/language", () => {
  it("401s signed out and 422s on an unsupported language", async () => {
    expect((await POST(jsonRequest(url, { primary: "es" }))).status).toBe(401);
    fake.signInAs(OWNER);
    expect((await POST(jsonRequest(url, { primary: "fr" }))).status).toBe(422);
  });

  it("stamps changed_at so the publish badge can see a language change", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", { data: { language_config: { primary: "en" } }, error: null });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    const res = await POST(jsonRequest(url, { primary: "es" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, changed: true });
    const update = fake.callsTo("tenants", "update")[0];
    expect(update?.filters).toContainEqual(["eq", "id", "t1"]);
    const payload = update?.payload as { language_config: Record<string, unknown> } | undefined;
    const config = payload?.language_config ?? {};
    expect(config).toMatchObject({ primary: "es", bilingual: false });
    expect(typeof config["changed_at"]).toBe("string");
  });

  it("does not write (or re-stamp) when the language is unchanged", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", { data: { language_config: { primary: "es" } }, error: null });
    const res = await POST(jsonRequest(url, { primary: "es" }));
    expect(await res.json()).toEqual({ ok: true, changed: false });
    expect(fake.callsTo("tenants", "update")).toHaveLength(0);
  });

  it("SETTINGS-1 review: the first change after a publish records the published language and keeps other keys", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", {
      data: { language_config: { primary: "en", bilingual: false, voice: "x" } },
      error: null,
    });
    fake.queue("agent_configs:select", {
      data: { published_at: "2026-09-23T02:28:50Z" },
      error: null,
    });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    await POST(jsonRequest(url, { primary: "es" }));
    const payload = fake.callsTo("tenants", "update")[0]?.payload as {
      language_config: Record<string, unknown>;
    };
    expect(payload.language_config).toMatchObject({
      primary: "es",
      bilingual: false,
      voice: "x",
      published_primary: "en",
    });
    expect(fake.callsTo("agent_configs", "select")[0]?.filters).toContainEqual([
      "eq",
      "tenant_id",
      "t1",
    ]);
  });

  it("SETTINGS-1 review: a later unpublished change carries the published language forward (so a revert clears the badge)", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", {
      data: {
        language_config: {
          primary: "es",
          bilingual: false,
          changed_at: "2026-09-29T01:00:00Z",
          published_primary: "en",
        },
      },
      error: null,
    });
    fake.queue("agent_configs:select", {
      data: { published_at: "2026-09-23T02:28:50Z" },
      error: null,
    });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    await POST(jsonRequest(url, { primary: "en" }));
    const payload = fake.callsTo("tenants", "update")[0]?.payload as {
      language_config: Record<string, unknown>;
    };
    expect(payload.language_config).toMatchObject({ primary: "en", published_primary: "en" });
  });

  it("SETTINGS-1 review: after a newer publish, the next change records the NEW published language", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", {
      data: {
        language_config: {
          primary: "es",
          changed_at: "2026-09-01T00:00:00Z",
          published_primary: "en",
        },
      },
      error: null,
    });
    fake.queue("agent_configs:select", {
      data: { published_at: "2026-09-02T00:00:00Z" },
      error: null,
    });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    await POST(jsonRequest(url, { primary: "en" }));
    const payload = fake.callsTo("tenants", "update")[0]?.payload as {
      language_config: Record<string, unknown>;
    };
    expect(payload.language_config).toMatchObject({ primary: "en", published_primary: "es" });
  });
});
