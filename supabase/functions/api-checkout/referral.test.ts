import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { attributeReferral, normalizeReferralCode } from "./referral.ts";

const logger = createLogger();

interface Call {
  text: string;
  values: unknown[];
}

/** Answers by query text; records every call. */
function makeSql(answers: { link?: unknown[]; attributed?: unknown[]; throwOn?: string }) {
  const calls: Call[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (answers.throwOn && text.includes(answers.throwOn)) {
      return Promise.reject(new Error("db down"));
    }
    if (text.includes("from public.referral_links")) return Promise.resolve(answers.link ?? []);
    if (text.includes("insert into public.referrals")) {
      return Promise.resolve(answers.attributed ?? []);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

const LINK = [{ link_id: "link-1", referral_partner_id: "partner-1", partner_user_id: "pu-1" }];

describe("normalizeReferralCode", () => {
  it("upper-cases valid codes and drops junk", () => {
    expect(normalizeReferralCode("abcd2345")).toBe("ABCD2345");
    expect(normalizeReferralCode("ab")).toBeNull();
    expect(normalizeReferralCode("no good!")).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
  });
});

describe("attributeReferral (PT-01)", () => {
  it("does nothing, and runs no SQL, without a (valid) code", async () => {
    const { sql, calls } = makeSql({});
    expect(
      await attributeReferral(
        sql,
        { tenantId: "t1", userId: "u1", referralCode: undefined },
        logger,
      ),
    ).toBe("no_code");
    expect(
      await attributeReferral(sql, { tenantId: "t1", userId: "u1", referralCode: "x" }, logger),
    ).toBe("no_code");
    expect(calls).toHaveLength(0);
  });

  it("ignores a code that matches no referral link", async () => {
    const { sql, calls } = makeSql({ link: [] });
    expect(
      await attributeReferral(
        sql,
        { tenantId: "t1", userId: "u1", referralCode: "NOPE1234" },
        logger,
      ),
    ).toBe("unknown_code");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual(["NOPE1234"]);
  });

  it("sets the tenant's referrer and inserts the pending referral in one statement", async () => {
    const { sql, calls } = makeSql({ link: LINK, attributed: [{ id: "ref-1" }] });
    const result = await attributeReferral(
      sql,
      { tenantId: "t1", userId: "u1", referralCode: "abcd2345" },
      logger,
    );
    expect(result).toBe("attributed");

    const write = calls.find((c) => c.text.includes("insert into public.referrals"));
    expect(write).toBeDefined();
    expect(write?.text).toContain("update public.tenants");
    expect(write?.text).toContain("referrer_partner_id is null");
    expect(write?.text).toContain("on conflict (referred_tenant_id) do nothing");
    expect(write?.values).toEqual(expect.arrayContaining(["partner-1", "link-1", "t1"]));
    // the code was looked up upper-cased
    expect(calls[0]?.values).toEqual(["ABCD2345"]);
  });

  it("refuses a partner referring their own account and writes nothing", async () => {
    const { sql, calls } = makeSql({ link: LINK, attributed: [{ id: "ref-1" }] });
    const result = await attributeReferral(
      sql,
      { tenantId: "t1", userId: "pu-1", referralCode: "ABCD2345" },
      logger,
    );
    expect(result).toBe("self_referral");
    expect(calls.some((c) => c.text.includes("insert into public.referrals"))).toBe(false);
  });

  it("reports an already-attributed tenant instead of re-attributing (idempotent retries)", async () => {
    const { sql } = makeSql({ link: LINK, attributed: [] });
    expect(
      await attributeReferral(
        sql,
        { tenantId: "t1", userId: "u1", referralCode: "ABCD2345" },
        logger,
      ),
    ).toBe("already_attributed");
  });

  it("never throws: a database failure returns 'error' so checkout still proceeds", async () => {
    const { sql } = makeSql({ link: LINK, throwOn: "insert into public.referrals" });
    expect(
      await attributeReferral(
        sql,
        { tenantId: "t1", userId: "u1", referralCode: "ABCD2345" },
        logger,
      ),
    ).toBe("error");
  });
});
