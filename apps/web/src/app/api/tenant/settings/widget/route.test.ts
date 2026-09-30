import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, jsonRequest, MEMBER, OWNER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});

const { POST } = await import("./route");
const { POST: ROTATE } = await import("./rotate-key/route");

const url = "/api/tenant/settings/widget";
const settings = {
  allowed_origins: ["https://Acme.example/", "https://acme.example", "https://www.acme.example"],
  accent: "#0EA5E9",
  position: "bottom-left",
  greeting: "  Hi there  ",
  modes: ["chat", "voice", "chat"],
};

beforeEach(() => fake.reset());

describe("POST /api/tenant/settings/widget (QA-1 F-13)", () => {
  it("401s signed out and 403s a member (RLS would silently drop the write)", async () => {
    expect((await POST(jsonRequest(url, { widget_settings: settings }))).status).toBe(401);
    fake.signInAs(MEMBER);
    const res = await POST(jsonRequest(url, { widget_settings: settings }));
    expect(res.status).toBe(403);
    expect(fake.callsTo("tenants", "update")).toHaveLength(0);
  });

  it("normalizes origins (lower-case, no trailing slash, unique), accent and modes before storing", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    const res = await POST(jsonRequest(url, { widget_settings: settings }));
    expect(res.status).toBe(200);
    const update = fake.callsTo("tenants", "update")[0];
    expect(update?.filters).toContainEqual(["eq", "id", "t1"]);
    expect(update?.payload).toEqual({
      widget_settings: {
        allowed_origins: ["https://acme.example", "https://www.acme.example"],
        accent: "#0ea5e9",
        position: "bottom-left",
        greeting: "Hi there",
        modes: ["chat", "voice"],
      },
    });
  });

  it("422s a non-hex accent", async () => {
    fake.signInAs(OWNER);
    const res = await POST(jsonRequest(url, { widget_settings: { ...settings, accent: "red" } }));
    expect(res.status).toBe(422);
    expect(fake.callsTo("tenants", "update")).toHaveLength(0);
  });

  it("422s when every mode is off", async () => {
    fake.signInAs(OWNER);
    const res = await POST(jsonRequest(url, { widget_settings: { ...settings, modes: [] } }));
    expect(res.status).toBe(422);
  });

  it.each([
    ["a wildcard", "https://*.acme.example"],
    ["plain http", "http://acme.example"],
    ["a path", "https://acme.example/app"],
    ["not a URL", "acme"],
  ])("422s an origin that is %s", async (_label, origin) => {
    fake.signInAs(OWNER);
    const res = await POST(
      jsonRequest(url, { widget_settings: { ...settings, allowed_origins: [origin] } }),
    );
    expect(res.status).toBe(422);
  });

  it("can flip only the enabled switch without resending settings", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    const res = await POST(jsonRequest(url, { widget_enabled: true }));
    expect(res.status).toBe(200);
    expect(fake.callsTo("tenants", "update")[0]?.payload).toEqual({ widget_enabled: true });
  });

  it("422s an empty body and 404s when RLS filtered the write to zero rows", async () => {
    fake.signInAs(OWNER);
    expect((await POST(jsonRequest(url, {}))).status).toBe(422);
    fake.queue("tenants:update", { data: [], error: null });
    expect((await POST(jsonRequest(url, { widget_enabled: false }))).status).toBe(404);
  });
});

describe("POST /api/tenant/settings/widget/rotate-key", () => {
  it("403s a member and never touches the key", async () => {
    fake.signInAs(MEMBER);
    expect((await ROTATE()).status).toBe(403);
    expect(fake.callsTo("tenants", "update")).toHaveLength(0);
  });

  it("issues a fresh server-generated key for the owner's own tenant", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    const res = await ROTATE();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { widget_public_key: string };
    expect(body.widget_public_key).toMatch(/^pk_[0-9a-f]{32}$/);
    const update = fake.callsTo("tenants", "update")[0];
    expect(update?.payload).toEqual({ widget_public_key: body.widget_public_key });
    expect(update?.filters).toContainEqual(["eq", "id", "t1"]);
  });

  it("404s when nothing was written", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:update", { data: [], error: null });
    expect((await ROTATE()).status).toBe(404);
  });
});
