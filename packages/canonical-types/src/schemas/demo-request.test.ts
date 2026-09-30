import { describe, expect, it } from "vitest";
import { demoRequestSchema } from "./demo-request.js";

describe("demoRequestSchema website_url (SEC-04)", () => {
  const ok = (website_url: string) =>
    demoRequestSchema.safeParse({ business_name: "Acme Auto", website_url }).success;

  it("accepts http and https URLs", () => {
    expect(ok("https://acme.example")).toBe(true);
    expect(ok("http://acme.example/services?x=1")).toBe(true);
  });

  it("rejects non-web schemes the scraper must never be pointed at", () => {
    expect(ok("file:///etc/passwd")).toBe(false);
    expect(ok("ftp://acme.example")).toBe(false);
    expect(ok("gopher://acme.example")).toBe(false);
    expect(ok("javascript:alert(1)")).toBe(false);
    expect(ok("not a url")).toBe(false);
  });
});
