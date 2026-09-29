import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/content/blog", () => ({
  listBlogPosts: async () => [
    { slug: "answering-every-call", title: "Answering", excerpt: "x", date: "2026-09-01" },
  ],
}));

// Only `config.matcher` is read from the middleware; its own imports are stubbed
// (same pnpm-hoisting quirk `src/middleware.test.ts` documents).
vi.mock("next-intl/middleware", () => ({ default: () => () => undefined }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({}) }));

const { default: robots } = await import("./robots");
const { default: sitemap } = await import("./sitemap");
const { GET: rss } = await import("./rss.xml/route");
const { config } = await import("../middleware");

function withBase<T>(fn: () => T | Promise<T>): Promise<T> {
  vi.stubEnv("APP_BASE_URL", "https://heyloo.example/");
  return Promise.resolve(fn()).finally(() => vi.unstubAllEnvs());
}

describe("robots.txt (F-09, SEC-20)", () => {
  it("allows marketing, disallows the app/auth/API surfaces, and points at the absolute sitemap", async () => {
    const r = await withBase(() => robots());
    const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rules?.allow).toBe("/");
    expect(rules?.disallow).toEqual(
      expect.arrayContaining(["/dashboard", "/cockpit", "/portal", "/api/", "/login", "/mfa"]),
    );
    expect(r.sitemap).toBe("https://heyloo.example/sitemap.xml");
  });
});

describe("sitemap.xml (F-09, SEC-20)", () => {
  it("lists home, pricing, demo, blog, legal, the vertical pages and each blog post with absolute URLs", async () => {
    const entries = await withBase(() => sitemap());
    const urls = entries.map((e) => e.url);
    for (const u of [
      "https://heyloo.example",
      "https://heyloo.example/pricing",
      "https://heyloo.example/demo",
      "https://heyloo.example/blog",
      "https://heyloo.example/legal/terms",
      "https://heyloo.example/legal/privacy",
      "https://heyloo.example/legal/dpa",
      "https://heyloo.example/blog/answering-every-call",
      "https://heyloo.example/auto-repair",
    ]) {
      expect(urls).toContain(u);
    }
    expect(urls.some((u) => u.includes("localhost"))).toBe(false);
    expect(urls.some((u) => u.includes("/signup") || u.includes("/generic"))).toBe(false);
  });
});

describe("rss.xml (F-09)", () => {
  it("is served as RSS with absolute item links", async () => {
    const res = await withBase(() => rss());
    expect(res.headers.get("content-type")).toContain("application/rss+xml");
    const body = await res.text();
    expect(body).toContain("<link>https://heyloo.example/blog/answering-every-call</link>");
  });
});

describe("middleware matcher (F-09)", () => {
  it("skips rss.xml, robots.txt and sitemap.xml so next-intl cannot rewrite them to /en/...", () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ["/rss.xml", "/robots.txt", "/sitemap.xml"]) {
      expect(pattern.test(path)).toBe(false);
    }
    expect(pattern.test("/pricing")).toBe(true);
    expect(pattern.test("/login")).toBe(true);
  });
});
