import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SupabaseAdminFetch } from "../_shared/providers/supabase-admin.ts";
import type { SqlClient } from "../_shared/types.ts";
import { handleTeamInvite } from "./handler.ts";

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

const notUsedFetch: SupabaseAdminFetch = () => Promise.reject(new Error("not used in this test"));

const deps = {
  supabaseAdmin: { fetchImpl: notUsedFetch, url: "https://x.supabase.co", serviceRoleKey: "k" },
  logger,
};

describe("handleTeamInvite", () => {
  it("403s when the caller is not the tenant owner", async () => {
    const { sql } = makeSql({ "from public.memberships": [{ role: "admin" }] });
    const result = await handleTeamInvite(
      sql,
      "t1",
      "u1",
      { email: "new@example.com", role: "member" },
      deps,
    );
    expect(result).toEqual({ status: 403, body: { error: "not_tenant_owner" } });
  });

  it("403s when the caller has no membership on this tenant at all", async () => {
    const { sql } = makeSql({ "from public.memberships": [] });
    const result = await handleTeamInvite(
      sql,
      "t1",
      "u1",
      { email: "new@example.com", role: "member" },
      deps,
    );
    expect(result).toEqual({ status: 403, body: { error: "not_tenant_owner" } });
  });

  it("invites a new user and inserts the membership row on success", async () => {
    const { sql, calls } = makeSql({
      "from public.memberships": [{ role: "owner" }],
      "insert into public.memberships": [{ id: "membership_1" }],
    });
    const result = await handleTeamInvite(
      sql,
      "t1",
      "u1",
      { email: "new@example.com", role: "admin" },
      {
        ...deps,
        supabaseAdmin: {
          ...deps.supabaseAdmin,
          fetchImpl: (async () =>
            new Response(JSON.stringify({ id: "auth_user_1" }), {
              status: 200,
            })) as SupabaseAdminFetch,
        },
      },
    );
    expect(result).toEqual({ status: 200, body: { invited: true, membership_id: "membership_1" } });
    expect(calls.some((c) => c.text.includes("insert into public.memberships"))).toBe(true);
  });

  it("adds an already-registered user directly to the tenant instead of re-inviting", async () => {
    // Two distinct `from public.memberships` selects happen in this flow
    // (the caller's own role, then whether the target user already has a
    // membership) — `makeSql`'s substring-keyed fixtures can't tell them
    // apart, so this test uses a small bespoke sql mock keyed on the
    // distinguishing `select role`/`select id` prefix instead.
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("select role from public.memberships")) {
        return Promise.resolve([{ role: "owner" }]);
      }
      if (text.includes("from auth.users")) {
        return Promise.resolve([{ id: "existing_user_1" }]);
      }
      if (text.includes("select id from public.memberships")) {
        return Promise.resolve([]); // not yet a member
      }
      if (text.includes("insert into public.memberships")) {
        return Promise.resolve([{ id: "membership_2" }]);
      }
      return Promise.resolve([]);
    }) as SqlClient;
    const result = await handleTeamInvite(
      sql,
      "t1",
      "u1",
      { email: "existing@example.com", role: "member" },
      {
        ...deps,
        supabaseAdmin: {
          ...deps.supabaseAdmin,
          fetchImpl: (async () =>
            new Response(JSON.stringify({ msg: "User already registered" }), {
              status: 422,
            })) as SupabaseAdminFetch,
        },
      },
    );
    expect(result).toEqual({ status: 200, body: { invited: true, membership_id: "membership_2" } });
  });

  it("502s when the GoTrue invite call itself fails (not an already-exists case)", async () => {
    const { sql } = makeSql({ "from public.memberships": [{ role: "owner" }] });
    const result = await handleTeamInvite(
      sql,
      "t1",
      "u1",
      { email: "new@example.com", role: "member" },
      {
        ...deps,
        supabaseAdmin: {
          ...deps.supabaseAdmin,
          fetchImpl: (async () =>
            new Response(JSON.stringify({ msg: "server error" }), {
              status: 500,
            })) as SupabaseAdminFetch,
        },
      },
    );
    expect(result).toEqual({ status: 502, body: { error: "invite_failed" } });
  });
});
