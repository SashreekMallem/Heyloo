import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

function makeFrom(queue: Record<string, unknown[]>) {
  return vi.fn((table: string) => {
    const q = queue[table];
    const result = q?.length ? q.shift() : { data: null, error: null };
    return chain(result);
  });
}

let serviceQueue: Record<string, unknown[]> = {};

vi.mock("@/lib/supabase/service-role", () => ({
  createSupabaseServiceRoleServerClient: () => ({ from: makeFrom(serviceQueue) }),
}));

const { GET } = await import("./route");

describe("GET /api/platform-settings/price-card", () => {
  it("omits fees when none are configured for the vertical", async () => {
    serviceQueue = {
      platform_settings: [
        {
          data: { value: { base_cents: 29900, included_minutes: 300, overage_cents: 45 } },
          error: null,
        },
        { data: null, error: null },
        { data: null, error: null },
      ],
    };
    const res = await GET(new Request("http://localhost/x?vertical=dental"));
    const body = (await res.json()) as {
      setup_fee_cents: number | null;
      white_glove_fee_cents: number | null;
    };
    expect(body.setup_fee_cents).toBeNull();
    expect(body.white_glove_fee_cents).toBeNull();
  });

  it("surfaces the setup/white-glove fee only when the admin enabled it", async () => {
    serviceQueue = {
      platform_settings: [
        {
          data: { value: { base_cents: 29900, included_minutes: 300, overage_cents: 45 } },
          error: null,
        },
        { data: null, error: null },
        {
          data: {
            value: {
              setup_fee_enabled: true,
              setup_fee_cents: 19900,
              white_glove_enabled: true,
              white_glove_fee_cents: 50000,
              white_glove_description: "We set everything up for you.",
            },
          },
          error: null,
        },
      ],
    };
    const res = await GET(new Request("http://localhost/x?vertical=dental"));
    const body = (await res.json()) as {
      setup_fee_cents: number | null;
      white_glove_fee_cents: number | null;
      white_glove_description: string | null;
    };
    expect(body.setup_fee_cents).toBe(19900);
    expect(body.white_glove_fee_cents).toBe(50000);
    expect(body.white_glove_description).toBe("We set everything up for you.");
  });
});
