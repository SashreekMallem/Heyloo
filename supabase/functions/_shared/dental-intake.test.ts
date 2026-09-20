import { describe, expect, it } from "vitest";
import { sha256Hex } from "./crypto.ts";
import { issueDentalIntakeToken } from "./dental-intake.ts";
import type { SqlClient } from "./types.ts";

function makeSql(): { sql: SqlClient; calls: { text: string; values: unknown[] }[] } {
  const calls: { text: string; values: unknown[] }[] = [];
  let tokenCounter = 0;
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    if (text.includes("insert into public.intake_tokens")) {
      tokenCounter += 1;
      return Promise.resolve([{ id: `intake_token_${tokenCounter}` }]);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

describe("issueDentalIntakeToken", () => {
  it("snapshots only the first word of customerName as patient_first_name", async () => {
    const { sql, calls } = makeSql();
    await issueDentalIntakeToken(
      sql,
      {
        tenantId: "t1",
        bookingId: "b1",
        customerPhoneE164: "+15551234567",
        customerName: "Jamie Rivera",
      },
      { appBaseUrl: "https://app.heyloo.com" },
    );
    const tokenInsert = calls.find((c) => c.text.includes("insert into public.intake_tokens"));
    expect(tokenInsert?.values).toContain("Jamie");
    expect(tokenInsert?.values).not.toContain("Jamie Rivera");
  });

  it("stores null patient_first_name when no customer name is known", async () => {
    const { sql, calls } = makeSql();
    await issueDentalIntakeToken(
      sql,
      { tenantId: "t1", bookingId: "b1", customerPhoneE164: "+15551234567" },
      { appBaseUrl: "https://app.heyloo.com" },
    );
    const tokenInsert = calls.find((c) => c.text.includes("insert into public.intake_tokens"));
    expect(tokenInsert?.values).toContain(null);
  });

  it("inserts an intake_tokens row storing only the token's hash, never the plaintext", async () => {
    const { sql, calls } = makeSql();
    await issueDentalIntakeToken(
      sql,
      { tenantId: "t1", bookingId: "b1", customerPhoneE164: "+15551234567" },
      { appBaseUrl: "https://app.heyloo.com" },
    );
    const tokenInsert = calls.find((c) => c.text.includes("insert into public.intake_tokens"));
    expect(tokenInsert).toBeDefined();
    const storedHash = tokenInsert?.values[2] as string;
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex, not a raw token
  });

  it("enqueues a dental_intake_link SMS whose payload.url embeds a token that hashes to the stored hash", async () => {
    const { sql, calls } = makeSql();
    await issueDentalIntakeToken(
      sql,
      { tenantId: "t1", bookingId: "b1", customerPhoneE164: "+15551234567" },
      { appBaseUrl: "https://app.heyloo.com" },
    );

    const tokenInsert = calls.find((c) => c.text.includes("insert into public.intake_tokens"));
    const storedHash = tokenInsert?.values[2] as string;

    const smsInsert = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(smsInsert).toBeDefined();
    expect(smsInsert?.values).toContain("t1");
    expect(smsInsert?.values).toContain("+15551234567");
    expect(smsInsert?.values).toContain("b1");
    // Regression (CALL-3 jsonb double-encoding fix): the `payload` value
    // bound to the `::jsonb` parameter must be the raw object, never a
    // caller-pre-stringified JSON string (postgres.js's own learned-type
    // serializer handles the encoding exactly once).
    const payload = smsInsert?.values.find(
      (v) => typeof v === "object" && v !== null && "url" in (v as object),
    ) as { url: string } | undefined;
    expect(payload).toBeDefined();
    expect(typeof payload).not.toBe("string");
    expect(payload?.url).toMatch(/^https:\/\/app\.heyloo\.com\/intake\/[A-Za-z0-9_-]+$/);
    const embeddedToken = payload?.url.split("/intake/")[1] as string;
    expect(await sha256Hex(embeddedToken)).toBe(storedHash);
  });

  it("strips a trailing slash from appBaseUrl so the URL never has a double slash", async () => {
    const { sql, calls } = makeSql();
    await issueDentalIntakeToken(
      sql,
      { tenantId: "t1", bookingId: "b1", customerPhoneE164: "+15551234567" },
      { appBaseUrl: "https://app.heyloo.com/" },
    );
    const smsInsert = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    const payload = smsInsert?.values.find(
      (v) => typeof v === "object" && v !== null && "url" in (v as object),
    ) as { url: string } | undefined;
    expect(payload?.url).not.toContain("com//intake");
  });

  it("generates a different token on every call", async () => {
    const { sql, calls } = makeSql();
    await issueDentalIntakeToken(
      sql,
      { tenantId: "t1", bookingId: "b1", customerPhoneE164: "+15551234567" },
      { appBaseUrl: "https://app.heyloo.com" },
    );
    await issueDentalIntakeToken(
      sql,
      { tenantId: "t1", bookingId: "b2", customerPhoneE164: "+15551234567" },
      { appBaseUrl: "https://app.heyloo.com" },
    );
    const hashes = calls
      .filter((c) => c.text.includes("insert into public.intake_tokens"))
      .map((c) => c.values[2]);
    expect(hashes[0]).not.toBe(hashes[1]);
  });
});
