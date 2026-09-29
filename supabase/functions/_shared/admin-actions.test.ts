import { describe, expect, it } from "vitest";
import { normalizeClientIp, writeAdminAction } from "./admin-actions.ts";
import type { SqlClient } from "./types.ts";

describe("normalizeClientIp (QA-1 COCKPIT-F02 / BE-09)", () => {
  it("takes the first hop of the gateway's comma-separated x-forwarded-for list", () => {
    expect(normalizeClientIp("35.202.184.100,35.202.184.100, 3.2.58.44")).toBe("35.202.184.100");
    expect(normalizeClientIp("  10.0.0.1 , 3.2.58.44")).toBe("10.0.0.1");
    expect(normalizeClientIp("2001:db8::1, 3.2.58.44")).toBe("2001:db8::1");
  });

  it("returns null for anything Postgres inet would reject", () => {
    for (const bad of [
      "",
      undefined,
      null,
      "unknown",
      "999.1.1.1",
      "1.2.3",
      "not-an-ip, 1.2.3.4",
      "1.2.3.4:8080",
      "::::",
      "gggg::1",
      "<script>",
    ]) {
      expect(normalizeClientIp(bad as string | undefined)).toBeNull();
    }
  });
});

describe("writeAdminAction", () => {
  it("binds only a valid single inet value, so the audit insert can never 22P02", async () => {
    let values: unknown[] = [];
    const sql = ((_strings: TemplateStringsArray, ...v: unknown[]) => {
      values = v;
      return Promise.resolve([]);
    }) as unknown as SqlClient;
    await writeAdminAction(sql, {
      adminUserId: "u1",
      action: "tenant.update",
      targetType: "tenant",
      targetId: "t1",
      ipAddress: "35.202.184.100,35.202.184.100, 3.2.58.44",
    });
    expect(values).toContain("35.202.184.100");
    expect(values.some((v) => typeof v === "string" && v.includes(","))).toBe(false);

    await writeAdminAction(sql, {
      adminUserId: "u1",
      action: "x",
      targetType: "tenant",
      ipAddress: "garbage",
    });
    expect(values).not.toContain("garbage");
  });
});
