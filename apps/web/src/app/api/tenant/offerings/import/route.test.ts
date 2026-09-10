import { describe, expect, it, vi } from "vitest";

const mockUser = { id: "u1", app_metadata: { tenant_id: "t1", role: "owner" } };

let mockSession: { user: unknown; access_token: string } | null = {
  user: mockUser,
  access_token: "token-123",
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: mockSession } }),
    },
  }),
}));

vi.mock("@/lib/env", () => ({
  env: {
    supabaseFunctionsUrl: "https://project.supabase.co/functions/v1",
  },
}));

const { POST } = await import("./route");

function postRequest(body: unknown) {
  return new Request("http://localhost/api/tenant/offerings/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/tenant/offerings/import", () => {
  it("401s when unauthenticated", async () => {
    mockSession = null;
    const res = await POST(postRequest({ raw_text: "Margherita Pizza — $14" }));
    expect(res.status).toBe(401);
  });

  it("422s when neither raw_text nor source is present", async () => {
    mockSession = { user: mockUser, access_token: "token-123" };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(postRequest({}));

    expect(res.status).toBe(422);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("forwards raw_text unchanged to api-menu-import", async () => {
    mockSession = { user: mockUser, access_token: "token-123" };
    let capturedUrl: string | undefined;
    let capturedBody: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedBody = init.body as string;
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }),
    );

    const res = await POST(postRequest({ raw_text: "Margherita Pizza — $14" }));

    expect(capturedUrl).toBe("https://project.supabase.co/functions/v1/api-menu-import");
    expect(JSON.parse(capturedBody as string)).toEqual({ raw_text: "Margherita Pizza — $14" });
    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it("forwards source:url unchanged to api-menu-import", async () => {
    mockSession = { user: mockUser, access_token: "token-123" };
    let capturedBody: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as string;
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }),
    );

    const source = { kind: "url", url: "https://example.com/menu" };
    const res = await POST(postRequest({ source }));

    expect(JSON.parse(capturedBody as string)).toEqual({ source });
    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it("forwards source:file unchanged to api-menu-import", async () => {
    mockSession = { user: mockUser, access_token: "token-123" };
    let capturedBody: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as string;
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }),
    );

    const source = { kind: "file", media_type: "application/pdf", data_base64: "aGVsbG8=" };
    const res = await POST(postRequest({ source }));

    expect(JSON.parse(capturedBody as string)).toEqual({ source });
    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it("422s an invalid source (unsupported media_type)", async () => {
    mockSession = { user: mockUser, access_token: "token-123" };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(
      postRequest({ source: { kind: "file", media_type: "text/plain", data_base64: "aGVsbG8=" } }),
    );

    expect(res.status).toBe(422);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("degrades to import_unavailable when the edge function 404s", async () => {
    mockSession = { user: mockUser, access_token: "token-123" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 })),
    );

    const res = await POST(postRequest({ raw_text: "Margherita Pizza — $14" }));

    expect(res.status).toBe(503);
    vi.unstubAllGlobals();
  });
});
