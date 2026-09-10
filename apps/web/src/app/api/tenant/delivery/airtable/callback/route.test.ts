import { beforeAll, describe, expect, it, vi } from "vitest";
import { encodeOAuthState, generatePkcePair, generateState } from "../shared";

const upsertCalls: unknown[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) => ({ value: cookieValue }),
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createSupabaseServiceRoleServerClient: () => ({
    from: (_table: string) => ({
      upsert: (data: unknown) => {
        upsertCalls.push(data);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

let cookieValue: string;

beforeAll(() => {
  process.env["AIRTABLE_OAUTH_STATE_SECRET"] = "test-secret-do-not-use-in-prod";
  process.env["AIRTABLE_OAUTH_CLIENT_ID"] = "client-1";
  process.env["AIRTABLE_OAUTH_REDIRECT_URI"] =
    "https://app.example.com/api/tenant/delivery/airtable/callback";
  process.env["ADAPTER_TOKEN_ENCRYPTION_KEY"] = Buffer.alloc(32, 7).toString("base64");
});

const { GET } = await import("./route");

function stubFetchSequence(responses: { url: string; body: unknown; ok?: boolean }[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const match = responses.find((r) => input === r.url);
      if (!match) throw new Error(`unexpected fetch: ${input}`);
      return new Response(JSON.stringify(match.body), { status: match.ok === false ? 500 : 200 });
    }),
  );
}

describe("GET /api/tenant/delivery/airtable/callback", () => {
  it("persists metadata.baseId and metadata.tableIdOrName from the connected base's first table", async () => {
    upsertCalls.length = 0;
    const verifier = generatePkcePair().verifier;
    const state = generateState();
    cookieValue = encodeOAuthState({ tenantId: "tenant-1", state, verifier });

    stubFetchSequence([
      {
        url: "https://airtable.com/oauth2/v1/token",
        body: { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 },
      },
      {
        url: "https://api.airtable.com/v0/meta/bases",
        body: { bases: [{ id: "base-123", name: "Bookings Base" }] },
      },
      {
        url: "https://api.airtable.com/v0/meta/bases/base-123/tables",
        body: { tables: [{ id: "tbl-abc", name: "Bookings" }] },
      },
    ]);

    const request = new Request(
      `http://localhost/api/tenant/delivery/airtable/callback?code=auth-code&state=${state}`,
    );
    const res = await GET(request);
    expect(res.status).toBe(200);

    expect(upsertCalls).toHaveLength(1);
    const upserted = upsertCalls[0] as { metadata: Record<string, unknown> };
    expect(upserted.metadata["baseId"]).toBe("base-123");
    expect(upserted.metadata["tableIdOrName"]).toBe("tbl-abc");
    expect(upserted.metadata["base_name"]).toBe("Bookings Base");

    vi.unstubAllGlobals();
  });
});
