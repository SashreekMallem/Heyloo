import { describe, expect, it } from "vitest";
import {
  DEMO_SESSIONS_PER_HOUR,
  demoSessionAlreadyMinted,
  demoSessionCeilingReached,
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

describe("demoSessionAlreadyMinted (SEC-04)", () => {
  it("is true only when a token was already stored for that session", async () => {
    expect(await demoSessionAlreadyMinted(sqlReturning([{ minted: true }]).sql, "s1")).toBe(true);
    expect(await demoSessionAlreadyMinted(sqlReturning([{ minted: false }]).sql, "s1")).toBe(false);
    expect(await demoSessionAlreadyMinted(sqlReturning([]).sql, "missing")).toBe(false);
  });
});
