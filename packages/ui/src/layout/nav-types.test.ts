import { describe, expect, it } from "vitest";
import { isNavItemActive, resolveActiveNavHref } from "./nav-types.js";

const ITEMS = [
  { href: "/dashboard", exact: true },
  { href: "/dashboard/calls" },
  { href: "/dashboard/agent" },
  { href: "/dashboard/agent/services" },
];

describe("isNavItemActive", () => {
  it("matches the path itself and nested paths", () => {
    expect(isNavItemActive({ href: "/dashboard/calls" }, "/dashboard/calls")).toBe(true);
    expect(isNavItemActive({ href: "/dashboard/calls" }, "/dashboard/calls/abc")).toBe(true);
  });

  it("does not match a sibling that merely shares a prefix", () => {
    expect(isNavItemActive({ href: "/dashboard/call" }, "/dashboard/calls")).toBe(false);
  });

  it("ignores a query string, hash and trailing slash", () => {
    expect(isNavItemActive({ href: "/dashboard/calls" }, "/dashboard/calls/?page=2#x")).toBe(true);
  });

  it("an exact item is active only on its own path (F-01)", () => {
    const overview = { href: "/dashboard", exact: true };
    expect(isNavItemActive(overview, "/dashboard")).toBe(true);
    expect(isNavItemActive(overview, "/dashboard/calls")).toBe(false);
  });
});

describe("resolveActiveNavHref", () => {
  it("never lights Overview on a nested dashboard page", () => {
    expect(resolveActiveNavHref(ITEMS, "/dashboard/calls")).toBe("/dashboard/calls");
    expect(resolveActiveNavHref(ITEMS, "/dashboard/messages")).toBeUndefined();
    expect(resolveActiveNavHref(ITEMS, "/dashboard")).toBe("/dashboard");
  });

  it("picks the longest matching href", () => {
    expect(resolveActiveNavHref(ITEMS, "/dashboard/agent/services")).toBe(
      "/dashboard/agent/services",
    );
    expect(resolveActiveNavHref(ITEMS, "/dashboard/agent/hours")).toBe("/dashboard/agent");
  });

  it("also protects a section root that forgot to set exact", () => {
    const items = [{ href: "/portal" }, { href: "/portal/payouts" }];
    expect(resolveActiveNavHref(items, "/portal/payouts")).toBe("/portal/payouts");
    expect(resolveActiveNavHref(items, "/portal")).toBe("/portal");
  });
});
