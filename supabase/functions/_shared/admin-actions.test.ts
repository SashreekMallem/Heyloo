import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADMIN_ACTION_TARGET_TYPES,
  normalizeAuditTarget,
  normalizeClientIp,
  writeAdminAction,
} from "./admin-actions.ts";
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

describe("normalizeAuditTarget (QA-2 COCKPIT-F02)", () => {
  const UUID = "3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f";

  it("keeps a uuid target and a listed type untouched", () => {
    expect(normalizeAuditTarget({ targetType: "tenant", targetId: UUID, after: { a: 1 } })).toEqual(
      {
        targetType: "tenant",
        targetId: UUID,
        after: { a: 1 },
      },
    );
  });

  it("binds a non-uuid target id as NULL (uuid column) and keeps it in after._target_ref", () => {
    // the pricing edit passes the vertical slug as the target id
    expect(
      normalizeAuditTarget({ targetType: "other", targetId: "dental", after: { price: 1 } }),
    ).toEqual({ targetType: "other", targetId: null, after: { price: 1, _target_ref: "dental" } });
    expect(normalizeAuditTarget({ targetType: "other", targetId: "dental" }).after).toEqual({
      _target_ref: "dental",
    });
  });

  it("falls back to 'other' for a type the CHECK does not list", () => {
    expect(normalizeAuditTarget({ targetType: "widget", targetId: UUID })).toEqual({
      targetType: "other",
      targetId: UUID,
      after: { _target_type: "widget" },
    });
  });

  it("accepts the outreach types the admin handler writes", () => {
    for (const t of ["lead", "suppression_list"]) {
      expect(normalizeAuditTarget({ targetType: t }).targetType).toBe(t);
    }
  });

  it("wraps a non-object after instead of dropping it", () => {
    expect(normalizeAuditTarget({ targetType: "other", targetId: "x", after: 5 }).after).toEqual({
      value: 5,
      _target_ref: "x",
    });
  });
});

describe("writeAdminAction bindings (QA-2 COCKPIT-F02)", () => {
  it("never binds a non-uuid target id or an unlisted type", async () => {
    let values: unknown[] = [];
    const sql = ((_s: TemplateStringsArray, ...v: unknown[]) => {
      values = v;
      return Promise.resolve([]);
    }) as unknown as SqlClient;
    await writeAdminAction(sql, {
      adminUserId: "u1",
      action: "platform_settings_pricing_edit",
      targetType: "other",
      targetId: "dental",
    });
    expect(values).not.toContain("dental");
    expect(values[2]).toBe("other");
    expect(values[3]).toBeNull();
    expect(values[5]).toEqual({ _target_ref: "dental" });
  });
});

describe("target type list vs the migrations", () => {
  const dir = new URL("../../migrations/", import.meta.url);
  const tenancy = readFileSync(new URL("20260907130100_tenancy.sql", dir), "utf8");
  const widened = readFileSync(
    new URL("20260930210600_qa2_backend_realtime_and_audit_types.sql", dir),
    "utf8",
  );

  it("every type the writer accepts is allowed by the latest CHECK", () => {
    for (const t of ADMIN_ACTION_TARGET_TYPES) expect(widened).toContain(`'${t}'`);
  });

  it("the widened CHECK is a superset of the original one", () => {
    const original = /target_type text not null\s+check \(target_type in \(([^)]*)\)/.exec(tenancy);
    expect(original).not.toBeNull();
    for (const m of (original?.[1] ?? "").matchAll(/'([a-z_]+)'/g)) {
      expect(ADMIN_ACTION_TARGET_TYPES).toContain(m[1]);
    }
  });

  it("every literal target type in the admin handler is accepted", () => {
    const handler = readFileSync(new URL("../admin/handler.ts", import.meta.url), "utf8");
    const used = [...handler.matchAll(/targetType: "([a-z_]+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(5);
    for (const t of used) expect(ADMIN_ACTION_TARGET_TYPES).toContain(t);
  });
});
