import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { OffboardingDeps, PortOutCandidateRow } from "./handler.ts";
import {
  archiveOneTenant,
  findArchiveCandidates,
  findPortOutCandidates,
  PORT_OUT_GRACE_DAYS,
  releaseOneNumber,
  runOffboarding,
} from "./handler.ts";

const logger = createLogger();

function candidateRow(overrides: Partial<PortOutCandidateRow> = {}): PortOutCandidateRow {
  return {
    phone_number_id: "pn1",
    tenant_id: "t1",
    e164: "+15551234567",
    twilio_sid: "PN123",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<OffboardingDeps> = {}): OffboardingDeps {
  return {
    retellFetch: (async () =>
      new Response("{}", { status: 200 })) as OffboardingDeps["retellFetch"],
    retellApiKey: "rk",
    twilioFetch: (async () =>
      new Response(null, { status: 204 })) as OffboardingDeps["twilioFetch"],
    twilioAccountSid: "AC1",
    twilioAuthToken: "tok",
    logger,
    ...overrides,
  };
}

describe("PORT_OUT_GRACE_DAYS", () => {
  it("is a 30-day guaranteed port-out window", () => {
    expect(PORT_OUT_GRACE_DAYS).toBe(30);
  });
});

function makeSql(fixtures: unknown[] = []): { sql: SqlClient; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const sql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push(values);
    return Promise.resolve(fixtures);
  }) as SqlClient;
  return { sql, calls };
}

describe("releaseOneNumber", () => {
  it("releases the number in Twilio and marks phone_numbers.released_at once Retell delete succeeds", async () => {
    const { sql, calls } = makeSql();
    const outcome = await releaseOneNumber(sql, candidateRow(), makeDeps());
    expect(outcome).toBe("released");
    expect(calls[0]).toContain("pn1");
  });

  it("does not release in Twilio (or write anything) when the Retell delete fails", async () => {
    const { sql, calls } = makeSql();
    const outcome = await releaseOneNumber(
      sql,
      candidateRow(),
      makeDeps({
        retellFetch: (async () =>
          new Response("{}", { status: 500 })) as OffboardingDeps["retellFetch"],
      }),
    );
    expect(outcome).toBe("retell_delete_failed");
    expect(calls).toHaveLength(0);
  });

  it("treats a Retell 404 (already deleted) as success and still proceeds to Twilio release", async () => {
    const { sql, calls } = makeSql();
    const outcome = await releaseOneNumber(
      sql,
      candidateRow(),
      makeDeps({
        retellFetch: (async () =>
          new Response("{}", { status: 404 })) as OffboardingDeps["retellFetch"],
      }),
    );
    expect(outcome).toBe("released");
    expect(calls).toHaveLength(1);
  });

  it("reports twilio_release_failed and writes nothing on a non-404 Twilio failure", async () => {
    const { sql, calls } = makeSql();
    const outcome = await releaseOneNumber(
      sql,
      candidateRow(),
      makeDeps({
        twilioFetch: (async () =>
          new Response("{}", { status: 500 })) as OffboardingDeps["twilioFetch"],
      }),
    );
    expect(outcome).toBe("twilio_release_failed");
    expect(calls).toHaveLength(0);
  });

  it("treats a Twilio 404 (already released) as success", async () => {
    const { sql } = makeSql();
    const outcome = await releaseOneNumber(
      sql,
      candidateRow(),
      makeDeps({
        twilioFetch: (async () =>
          new Response("{}", { status: 404 })) as OffboardingDeps["twilioFetch"],
      }),
    );
    expect(outcome).toBe("released");
  });
});

describe("archiveOneTenant / finders", () => {
  it("findPortOutCandidates/findArchiveCandidates pass through query results", async () => {
    const { sql: sql1 } = makeSql([candidateRow()]);
    expect(await findPortOutCandidates(sql1, new Date())).toHaveLength(1);
    const { sql: sql2 } = makeSql([{ tenant_id: "t1" }]);
    expect(await findArchiveCandidates(sql2, new Date())).toHaveLength(1);
  });

  it("archiveOneTenant issues an update scoped to that tenant", async () => {
    const { sql, calls } = makeSql();
    await archiveOneTenant(sql, "t1");
    expect(calls[0]).toContain("t1");
  });
});

describe("runOffboarding", () => {
  it("releases eligible numbers then archives tenants with none left active", async () => {
    let call = 0;
    const sql = ((_strings: TemplateStringsArray, ..._values: unknown[]) => {
      call += 1;
      if (call === 1) return Promise.resolve([candidateRow()]); // findPortOutCandidates
      if (call === 2) return Promise.resolve([]); // update phone_numbers.released_at
      if (call === 3) return Promise.resolve([{ tenant_id: "t1" }]); // findArchiveCandidates
      return Promise.resolve([]); // archive update
    }) as SqlClient;

    const result = await runOffboarding(sql, new Date("2026-09-10T00:00:00Z"), makeDeps());
    expect(result).toEqual({ numbers_released: 1, numbers_failed: 0, tenants_archived: 1 });
  });
});
