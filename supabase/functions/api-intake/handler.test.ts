import { describe, expect, it } from "vitest";
import { decryptSecret, sha256Hex } from "../_shared/crypto.ts";
import { createLogger } from "../_shared/logger.ts";
import type { IntakeSubmitBody } from "../_shared/schemas/intake.ts";
import type { SqlClient } from "../_shared/types.ts";
import { getIntakeStatus, submitIntake } from "./handler.ts";

const logger = createLogger();
const KEY = btoa("abcdefghijklmnopqrstuvwxyz012345"); // 32 raw bytes, test-only

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

const NOW = new Date("2026-09-10T12:00:00Z");

function baseSubmit(overrides: Partial<IntakeSubmitBody> = {}): IntakeSubmitBody {
  return {
    date_of_birth: "1990-05-12",
    insurance_provider: "Delta Dental",
    insurance_member_id: "MEM123",
    insurance_group_id: "GRP456",
    ...overrides,
  };
}

describe("getIntakeStatus (GET /api-intake/{token})", () => {
  it("returns 404 {valid:false} for an unknown token", async () => {
    const { sql } = makeSql({ "from public.intake_tokens": [] });
    const result = await getIntakeStatus(sql, "tok");
    expect(result).toEqual({ status: 404, body: { valid: false } });
  });

  it("returns 404 {valid:false} for an expired token (never distinguished from unknown)", async () => {
    const { sql } = makeSql({
      "from public.intake_tokens": [
        {
          id: "tok1",
          tenant_id: "t1",
          booking_id: "b1",
          patient_first_name: "Jamie",
          used_at: null,
          expires_at: "2020-01-01T00:00:00Z",
        },
      ],
    });
    const result = await getIntakeStatus(sql, "tok");
    expect(result).toEqual({ status: 404, body: { valid: false } });
  });

  it("returns valid:true with tenant_name/patient_first_name/already_submitted", async () => {
    const { sql } = makeSql({
      "from public.intake_tokens": [
        {
          id: "tok1",
          tenant_id: "t1",
          booking_id: "b1",
          patient_first_name: "Jamie",
          used_at: null,
          expires_at: "2099-01-01T00:00:00Z",
        },
      ],
      "select name from public.tenants": [{ name: "Bright Smiles Dental" }],
    });
    const result = await getIntakeStatus(sql, "tok");
    expect(result).toEqual({
      status: 200,
      body: {
        valid: true,
        tenant_name: "Bright Smiles Dental",
        patient_first_name: "Jamie",
        already_submitted: false,
      },
    });
  });

  it("reports already_submitted:true (still 200 valid:true) for a used but unexpired token", async () => {
    const { sql } = makeSql({
      "from public.intake_tokens": [
        {
          id: "tok1",
          tenant_id: "t1",
          booking_id: "b1",
          patient_first_name: null,
          used_at: "2026-09-01T00:00:00Z",
          expires_at: "2099-01-01T00:00:00Z",
        },
      ],
      "select name from public.tenants": [{ name: "Bright Smiles Dental" }],
    });
    const result = await getIntakeStatus(sql, "tok");
    expect((result.body as { already_submitted: boolean }).already_submitted).toBe(true);
  });

  it("hashes the presented token before ever querying by it", async () => {
    const { sql, calls } = makeSql({ "from public.intake_tokens": [] });
    const token = "a-valid-looking-opaque-token-value";
    await getIntakeStatus(sql, token);
    const lookup = calls.find((c) => c.text.includes("select id, tenant_id, booking_id"));
    expect(lookup?.values).toContain(await sha256Hex(token));
    expect(lookup?.values).not.toContain(token);
  });
});

describe("submitIntake (POST /api-intake/{token}) — always HTTP 200, ok flag carries the outcome", () => {
  it("returns 200 {ok:false, error:'invalid'} for an unknown token", async () => {
    const { sql } = makeSql({ "from public.intake_tokens": [] });
    const result = await submitIntake(
      sql,
      "tok",
      baseSubmit(),
      { intakeEncryptionKey: KEY, logger },
      NOW,
    );
    expect(result).toEqual({ status: 200, body: { ok: false, error: "invalid" } });
  });

  it("returns 200 {ok:false, error:'expired'} for an expired token", async () => {
    const { sql } = makeSql({
      "from public.intake_tokens": [
        {
          id: "tok1",
          tenant_id: "t1",
          booking_id: "b1",
          used_at: null,
          expires_at: "2020-01-01T00:00:00Z",
        },
      ],
    });
    const result = await submitIntake(
      sql,
      "tok",
      baseSubmit(),
      { intakeEncryptionKey: KEY, logger },
      NOW,
    );
    expect(result).toEqual({ status: 200, body: { ok: false, error: "expired" } });
  });

  it("returns 200 {ok:false, error:'already_submitted'} for an already-used token", async () => {
    const { sql } = makeSql({
      "from public.intake_tokens": [
        {
          id: "tok1",
          tenant_id: "t1",
          booking_id: "b1",
          used_at: "2026-09-05T00:00:00Z",
          expires_at: "2026-09-20T00:00:00Z",
        },
      ],
    });
    const result = await submitIntake(
      sql,
      "tok",
      baseSubmit(),
      { intakeEncryptionKey: KEY, logger },
      NOW,
    );
    expect(result).toEqual({ status: 200, body: { ok: false, error: "already_submitted" } });
  });

  it("returns 200 {ok:false, error:'already_submitted'} when the single-use UPDATE loses a concurrent race", async () => {
    const { sql } = makeSql({
      "from public.intake_tokens": [
        {
          id: "tok1",
          tenant_id: "t1",
          booking_id: "b1",
          used_at: null,
          expires_at: "2026-09-20T00:00:00Z",
        },
      ],
      "update public.intake_tokens set used_at": [], // 0 rows — lost the race
    });
    const result = await submitIntake(
      sql,
      "tok",
      baseSubmit(),
      { intakeEncryptionKey: KEY, logger },
      NOW,
    );
    expect(result).toEqual({ status: 200, body: { ok: false, error: "already_submitted" } });
  });

  it("encrypts DOB/insurance fields at rest, using date_of_birth/insurance_group_id field names", async () => {
    const { sql, calls } = makeSql({
      "from public.intake_tokens": [
        {
          id: "tok1",
          tenant_id: "t1",
          booking_id: "b1",
          used_at: null,
          expires_at: "2026-09-20T00:00:00Z",
        },
      ],
      "update public.intake_tokens set used_at": [{ id: "tok1" }],
    });
    const result = await submitIntake(
      sql,
      "tok",
      baseSubmit(),
      { intakeEncryptionKey: KEY, logger },
      NOW,
    );
    expect(result).toEqual({ status: 200, body: { ok: true } });

    const submissionInsert = calls.find((c) =>
      c.text.includes("insert into public.intake_submissions"),
    );
    const values = submissionInsert?.values as unknown[];
    // [tenant_id, booking_id, intake_token_id, dob, provider, member_id, group_id]
    expect(values[0]).toBe("t1");
    expect(values[1]).toBe("b1");
    expect(values[2]).toBe("tok1");
    expect(await decryptSecret(values[3] as string, KEY)).toBe("1990-05-12");
    expect(await decryptSecret(values[4] as string, KEY)).toBe("Delta Dental");
    expect(await decryptSecret(values[6] as string, KEY)).toBe("GRP456");
  });

  it("stores null for an omitted optional insurance field rather than an encrypted empty string", async () => {
    const { sql, calls } = makeSql({
      "from public.intake_tokens": [
        {
          id: "tok1",
          tenant_id: "t1",
          booking_id: "b1",
          used_at: null,
          expires_at: "2026-09-20T00:00:00Z",
        },
      ],
      "update public.intake_tokens set used_at": [{ id: "tok1" }],
    });
    await submitIntake(
      sql,
      "tok",
      baseSubmit({
        insurance_provider: undefined,
        insurance_member_id: undefined,
        insurance_group_id: undefined,
      }),
      { intakeEncryptionKey: KEY, logger },
      NOW,
    );
    const submissionInsert = calls.find((c) =>
      c.text.includes("insert into public.intake_submissions"),
    );
    const values = submissionInsert?.values as unknown[];
    expect(values[4]).toBeNull();
    expect(values[5]).toBeNull();
    expect(values[6]).toBeNull();
  });
});
