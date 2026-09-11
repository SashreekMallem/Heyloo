import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "maybeSingle"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

let tenantRow: unknown;

vi.mock("@/lib/supabase/service-role", () => ({
  createSupabaseServiceRoleServerClient: () => ({
    from: vi.fn(() => chain({ data: tenantRow, error: null })),
  }),
}));

const { resolveWidgetTenant } = await import("./resolve-tenant");

describe("resolveWidgetTenant", () => {
  it("returns null when no widget_public_key is given", async () => {
    expect(await resolveWidgetTenant("", "https://x.example")).toBeNull();
  });

  it("returns null when no tenant row matches the key", async () => {
    tenantRow = null;
    expect(await resolveWidgetTenant("pk_missing", "https://x.example")).toBeNull();
  });

  it("returns null when widget_enabled is false", async () => {
    tenantRow = {
      id: "t1",
      name: "Acme",
      widget_enabled: false,
      widget_settings: { allowed_origins: ["https://x.example"], modes: ["chat"] },
    };
    expect(await resolveWidgetTenant("pk_1", "https://x.example")).toBeNull();
  });

  it("returns null when the Origin isn't in allowed_origins", async () => {
    tenantRow = {
      id: "t1",
      name: "Acme",
      widget_enabled: true,
      widget_settings: { allowed_origins: ["https://allowed.example"], modes: ["chat"] },
    };
    expect(await resolveWidgetTenant("pk_1", "https://not-allowed.example")).toBeNull();
  });

  it("returns null when the Origin header is absent entirely", async () => {
    tenantRow = {
      id: "t1",
      name: "Acme",
      widget_enabled: true,
      widget_settings: { allowed_origins: ["https://allowed.example"], modes: ["chat"] },
    };
    expect(await resolveWidgetTenant("pk_1", null)).toBeNull();
  });

  it("returns the tenant context when enabled, key matches, and origin is allowed", async () => {
    tenantRow = {
      id: "t1",
      name: "Acme Dental",
      widget_enabled: true,
      widget_settings: {
        allowed_origins: ["https://allowed.example"],
        accent: "#0ea5e9",
        position: "bottom-left",
        greeting: "Hi!",
        modes: ["voice", "chat"],
      },
    };
    const result = await resolveWidgetTenant("pk_1", "https://allowed.example");
    expect(result).toEqual({
      tenantId: "t1",
      businessName: "Acme Dental",
      settings: {
        allowed_origins: ["https://allowed.example"],
        accent: "#0ea5e9",
        position: "bottom-left",
        greeting: "Hi!",
        modes: ["voice", "chat"],
      },
    });
  });

  it("degrades a malformed widget_settings jsonb to the safe default (no origin ever passes)", async () => {
    tenantRow = { id: "t1", name: "Acme", widget_enabled: true, widget_settings: "not-an-object" };
    expect(await resolveWidgetTenant("pk_1", "https://anything.example")).toBeNull();
  });
});
