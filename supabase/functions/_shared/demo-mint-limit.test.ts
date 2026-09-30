import { describe, expect, it } from "vitest";
import {
  claimDemoSessionMint,
  DEMO_SESSIONS_PER_HOUR,
  demoSessionCeilingReached,
  releaseDemoSessionMint,
} from "./demo-mint-limit.ts";
import type { SqlClient } from "./types.ts";

function sqlReturning(rows: unknown[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(rows);
  }) as unknown as SqlClient;
  return { sql, calls };
}

describe("demoSessionCeilingReached (SEC-04)", () => {
  const now = new Date("2026-09-30T12:00:00Z");

  it("counts demo_sessions from the last hour and stays open below the ceiling", async () => {
    const { sql, calls } = sqlReturning([{ n: DEMO_SESSIONS_PER_HOUR - 1 }]);
    expect(await demoSessionCeilingReached(sql, now)).toBe(false);
    expect(calls[0]?.text).toContain("public.demo_sessions");
    expect(calls[0]?.values[0]).toBe("2026-09-30T11:00:00.000Z");
  });

  it("closes at the ceiling", async () => {
    const { sql } = sqlReturning([{ n: DEMO_SESSIONS_PER_HOUR }]);
    expect(await demoSessionCeilingReached(sql, now)).toBe(true);
  });

  it("honours a custom ceiling", async () => {
    const { sql } = sqlReturning([{ n: 3 }]);
    expect(await demoSessionCeilingReached(sql, now, 3)).toBe(true);
  });
});

describe("claimDemoSessionMint (SEC-04)", () => {
  it("claims with one conditional UPDATE that only matches an unminted session", async () => {
    const { sql, calls } = sqlReturning([{ id: "s1" }]);
    expect(await claimDemoSessionMint(sql, "s1")).toBe("claimed");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("retell_call_token is null");
  });

  it("is taken when the session exists but the conditional UPDATE matched nothing", async () => {
    const answers = [[], [{ id: "s1" }]];
    const sql = (() => Promise.resolve(answers.shift() ?? [])) as unknown as SqlClient;
    expect(await claimDemoSessionMint(sql, "s1")).toBe("taken");
  });

  it("is unknown for a session that does not exist, so the handler still answers 404", async () => {
    expect(await claimDemoSessionMint(sqlReturning([]).sql, "missing")).toBe("unknown");
  });
});

describe("releaseDemoSessionMint (SEC-04)", () => {
  it("only clears the in-progress placeholder, never a real token", async () => {
    const { sql, calls } = sqlReturning([]);
    await releaseDemoSessionMint(sql, "s1");
    expect(calls[0]?.text).toContain("set retell_call_token = null");
    expect(calls[0]?.values).toEqual(["s1", "minting"]);
  });
});
