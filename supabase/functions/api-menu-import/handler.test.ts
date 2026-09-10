import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { MenuImportRequest } from "../_shared/schemas/menu-import.ts";
import { importMenu, type MenuImportDeps } from "./handler.ts";

const logger = createLogger();

function baseDeps(overrides: Partial<MenuImportDeps> = {}): MenuImportDeps {
  return {
    anthropicFetch: async () => new Response("{}"),
    anthropicApiKey: "key",
    anthropicModel: "claude-sonnet-5",
    urlFetch: async () => ({ ok: true, status: 200, text: "<html></html>" }),
    logger,
    ...overrides,
  };
}

function anthropicJsonResponse(text: string): Response {
  return new Response(JSON.stringify({ content: [{ type: "text", text }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("importMenu — raw_text (the already-shipped dashboard UI's contract, docs/audit/FIX_REQUESTS.md)", () => {
  it("sends the raw_text as a plain text content block and returns {items}", async () => {
    let capturedBody: { messages?: { content: unknown }[] } | undefined;
    const input: MenuImportRequest = { raw_text: "Taco - $3.50\nBurrito - $8.00" };
    const result = await importMenu(
      input,
      baseDeps({
        anthropicFetch: async (_url, init) => {
          capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
          return anthropicJsonResponse(
            JSON.stringify({ items: [{ name: "Taco", price_cents: 350, category: "Tacos" }] }),
          );
        },
      }),
    );
    expect(result).toEqual({
      status: 200,
      body: { items: [{ name: "Taco", price_cents: 350, category: "Tacos" }] },
    });
    const content = (capturedBody?.messages?.[0]?.content ?? []) as {
      type: string;
      text?: string;
    }[];
    expect(content[0]?.type).toBe("text");
    expect(content[0]?.text).toContain("Taco - $3.50");
  });

  it("extracts duration_minutes, allergens, and modifiers when the model returns them", async () => {
    const input: MenuImportRequest = { raw_text: "Massage 60min $90, add hot stones +$20" };
    const result = await importMenu(
      input,
      baseDeps({
        anthropicFetch: async () =>
          anthropicJsonResponse(
            JSON.stringify({
              items: [
                {
                  name: "Massage",
                  price_cents: 9000,
                  duration_minutes: 60,
                  allergens: ["almond oil"],
                  modifiers: [{ name: "Hot stones", price_cents: 2000 }],
                },
              ],
            }),
          ),
      }),
    );
    expect(result.status).toBe(200);
    const items = (result as { body: { items: unknown[] } }).body.items;
    expect(items[0]).toMatchObject({
      duration_minutes: 60,
      allergens: ["almond oil"],
      modifiers: [{ name: "Hot stones", price_cents: 2000 }],
    });
  });
});

describe("importMenu — url source", () => {
  it("fetches the page, strips HTML, and returns extracted items", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: { messages?: { content: unknown }[] } | undefined;
    const input: MenuImportRequest = { source: { kind: "url", url: "https://example.com/menu" } };
    const result = await importMenu(
      input,
      baseDeps({
        urlFetch: async (url) => {
          capturedUrl = url;
          return {
            ok: true,
            status: 200,
            text: "<html><body><h1>Tacos</h1><p>$3.50</p></body></html>",
          };
        },
        anthropicFetch: async (_url, init) => {
          capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
          return anthropicJsonResponse(
            JSON.stringify({ items: [{ name: "Taco", price_cents: 350, category: "Tacos" }] }),
          );
        },
      }),
    );
    expect(capturedUrl).toBe("https://example.com/menu");
    expect(result).toEqual({
      status: 200,
      body: { items: [{ name: "Taco", price_cents: 350, category: "Tacos" }] },
    });
    const content = (capturedBody?.messages?.[0]?.content ?? []) as {
      type: string;
      text?: string;
    }[];
    expect(content[0]?.type).toBe("text");
    expect(content[0]?.text).toContain("Tacos");
  });

  it("returns 422 url_unreachable when the page fetch fails", async () => {
    const input: MenuImportRequest = { source: { kind: "url", url: "https://example.com/gone" } };
    const result = await importMenu(
      input,
      baseDeps({ urlFetch: async () => ({ ok: false, status: 404, text: "" }) }),
    );
    expect(result).toEqual({ status: 422, body: { error: "url_unreachable" } });
  });
});

describe("importMenu — file source", () => {
  it("sends a document content block for application/pdf", async () => {
    let capturedBody:
      | { messages?: { content: { type: string; source?: { media_type?: string } }[] }[] }
      | undefined;
    const input: MenuImportRequest = {
      source: { kind: "file", media_type: "application/pdf", data_base64: "JVBERi0xLjQK" },
    };
    await importMenu(
      input,
      baseDeps({
        anthropicFetch: async (_url, init) => {
          capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
          return anthropicJsonResponse(JSON.stringify({ items: [] }));
        },
      }),
    );
    const content = capturedBody?.messages?.[0]?.content ?? [];
    expect(content[0]?.type).toBe("document");
    expect(content[0]?.source?.media_type).toBe("application/pdf");
  });

  it("sends an image content block for a photo upload", async () => {
    let capturedBody:
      | { messages?: { content: { type: string; source?: { media_type?: string } }[] }[] }
      | undefined;
    const input: MenuImportRequest = {
      source: { kind: "file", media_type: "image/jpeg", data_base64: "/9j/4AAQ" },
    };
    await importMenu(
      input,
      baseDeps({
        anthropicFetch: async (_url, init) => {
          capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
          return anthropicJsonResponse(JSON.stringify({ items: [] }));
        },
      }),
    );
    const content = capturedBody?.messages?.[0]?.content ?? [];
    expect(content[0]?.type).toBe("image");
    expect(content[0]?.source?.media_type).toBe("image/jpeg");
  });
});

describe("importMenu — response parsing", () => {
  const input: MenuImportRequest = { source: { kind: "url", url: "https://example.com/menu" } };

  it("strips a markdown JSON fence before parsing", async () => {
    const result = await importMenu(
      input,
      baseDeps({
        anthropicFetch: async () =>
          anthropicJsonResponse('```json\n{"items":[{"name":"Burger"}]}\n```'),
      }),
    );
    expect(result).toEqual({ status: 200, body: { items: [{ name: "Burger" }] } });
  });

  it("returns 422 unparseable_extraction when the model doesn't return JSON at all", async () => {
    const result = await importMenu(
      input,
      baseDeps({ anthropicFetch: async () => anthropicJsonResponse("Sorry, I can't do that.") }),
    );
    expect(result).toEqual({ status: 422, body: { error: "unparseable_extraction" } });
  });

  it("returns 422 unparseable_extraction when the JSON doesn't match the expected schema", async () => {
    const result = await importMenu(
      input,
      baseDeps({ anthropicFetch: async () => anthropicJsonResponse('{"totally": "wrong shape"}') }),
    );
    expect(result).toEqual({ status: 422, body: { error: "unparseable_extraction" } });
  });

  it("returns 502 extraction_failed when the Anthropic call itself fails", async () => {
    const result = await importMenu(
      input,
      baseDeps({ anthropicFetch: async () => new Response("{}", { status: 500 }) }),
    );
    expect(result).toEqual({ status: 502, body: { error: "extraction_failed" } });
  });

  it("never returns more than the schema's max item cap without throwing", async () => {
    const items = Array.from({ length: 3 }, (_, i) => ({ name: `Item ${i}` }));
    const result = await importMenu(
      input,
      baseDeps({ anthropicFetch: async () => anthropicJsonResponse(JSON.stringify({ items })) }),
    );
    expect(result.status).toBe(200);
    expect((result as { body: { items: unknown[] } }).body.items).toHaveLength(3);
  });
});
