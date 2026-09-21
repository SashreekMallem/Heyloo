import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { completeTestCheckout } from "./handler.ts";

const logger = createLogger();

function makeSql(fixtures: Record<string, unknown[]> = {}): {
  sql: SqlClient;
  calls: { text: string; values: unknown[] }[];
} {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

describe("completeTestCheckout", () => {
  it("rejects an invalid body (bad vertical)", async () => {
    const { sql } = makeSql();
    const result = await completeTestCheckout(
      sql,
      { vertical: "not_a_vertical", business_name: "Acme", email: "a@example.com" },
      { logger, randomSuffix: () => "abc123" },
    );
    expect(result).toEqual({ status: 422, body: { error: "invalid_request" } });
  });

  it("404s when no auth.users row matches the email", async () => {
    const { sql } = makeSql({ "from auth.users": [] });
    const result = await completeTestCheckout(
      sql,
      { vertical: "auto", business_name: "Acme Auto", email: "nobody@example.com" },
      { logger, randomSuffix: () => "abc123" },
    );
    expect(result).toEqual({ status: 404, body: { error: "user_not_found" } });
  });

  it("creates an is_test tenant + owner membership for a fresh signup", async () => {
    const { sql, calls } = makeSql({
      "from auth.users": [{ id: "user_1" }],
      "join public.memberships": [],
      "returning id": [{ id: "tenant_1" }],
    });
    const result = await completeTestCheckout(
      sql,
      { vertical: "auto", business_name: "SIGNUP-1 Test Auto", email: "signup-test@example.com" },
      { logger, randomSuffix: () => "abc123" },
    );
    expect(result).toEqual({ status: 200, body: { tenant_id: "tenant_1" } });

    const tenantInsert = calls.find((c) => c.text.includes("insert into public.tenants"));
    expect(tenantInsert?.text).toContain("is_test");
    // `true` is written literally into the query (never interpolated as a
    // value) so a test tenant can never be created with is_test=false by
    // accident — this function ALWAYS creates test tenants.
    expect(tenantInsert?.text).toMatch(/'trialing',\s*true\s*\)/);

    const membershipInsert = calls.find((c) => c.text.includes("insert into public.memberships"));
    expect(membershipInsert?.values).toEqual(["tenant_1", "user_1"]);
    expect(membershipInsert?.text).toContain("'owner'");
  });

  it("honors an explicit slug override (SIGNUP-1's own pinned slug)", async () => {
    const { sql, calls } = makeSql({
      "from auth.users": [{ id: "user_1" }],
      "join public.memberships": [],
      "returning id": [{ id: "tenant_1" }],
    });
    await completeTestCheckout(
      sql,
      {
        vertical: "auto",
        business_name: "SIGNUP-1 Test Auto",
        email: "signup-test@example.com",
        slug: "signup-1-auto",
      },
      { logger, randomSuffix: () => "should-not-be-used" },
    );
    const tenantInsert = calls.find((c) => c.text.includes("insert into public.tenants"));
    expect(tenantInsert?.values).toContain("signup-1-auto");
  });

  it("reuses an existing not-yet-provisioned test tenant for the same owner (idempotent re-run)", async () => {
    const { sql, calls } = makeSql({
      "from auth.users": [{ id: "user_1" }],
      "join public.memberships": [{ id: "tenant_existing" }],
    });
    const result = await completeTestCheckout(
      sql,
      { vertical: "auto", business_name: "SIGNUP-1 Test Auto", email: "signup-test@example.com" },
      { logger, randomSuffix: () => "abc123" },
    );
    expect(result).toEqual({ status: 200, body: { tenant_id: "tenant_existing" } });
    expect(calls.some((c) => c.text.includes("insert into public.tenants"))).toBe(false);
  });
});
