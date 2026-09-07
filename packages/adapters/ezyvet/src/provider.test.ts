import { describe, expect, it } from "vitest";
import { EzyVetProvider } from "./provider.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const OPTIONS = { clientId: "c1", clientSecret: "s1", partnerId: "p1" };
const CONNECTION = { accessToken: "t", metadata: { baseUrl: "https://clinic.ezyvet.com/api/v1" } };

describe("EzyVetProvider", () => {
  it("declares capabilities: no confirmed webhook coverage, client-credentials auth", () => {
    const provider = new EzyVetProvider(OPTIONS);
    expect(provider.capabilities).toMatchObject({
      supportsChangeWebhooks: false,
      supportsOrderPush: false,
      authMode: "oauth2_client_credentials",
    });
  });

  it("throws a clear validation error when a connection has no metadata.baseUrl", async () => {
    const provider = new EzyVetProvider(OPTIONS);
    await expect(provider.syncCatalog({ accessToken: "t" })).rejects.toThrow(/metadata.baseUrl/);
  });

  it("resolves the practice-specific base URL per connection for every operation", async () => {
    const capturedUrls: string[] = [];
    const provider = new EzyVetProvider({
      ...OPTIONS,
      clientOptions: {
        fetchImpl: (async (url: unknown) => {
          capturedUrls.push(String(url));
          return jsonResponse({ items: [] });
        }) as unknown as typeof fetch,
      },
    });

    await provider.syncCatalog(CONNECTION);
    expect(capturedUrls[0]).toContain("https://clinic.ezyvet.com/api/v1");
  });

  it("always returns webhook-unsupported (poll-only two-way sync)", async () => {
    const provider = new EzyVetProvider(OPTIONS);
    const result = await provider.handleWebhook({
      rawBody: "",
      headers: {},
      connection: CONNECTION,
    });
    expect(result.valid).toBe(false);
  });
});
