import { beforeEach, describe, expect, it } from "vitest";
import {
  clearImpersonation,
  readImpersonationState,
  setEditMode,
  startImpersonation,
} from "./state";

beforeEach(() => {
  localStorage.clear();
});

describe("impersonation localStorage state", () => {
  it("round-trips a started impersonation for the matching tenant", () => {
    startImpersonation({
      tenantId: "t1",
      tenantName: "Acme",
      adminEmail: "admin@heyloo.ai",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      editMode: false,
    });
    expect(readImpersonationState("t1")).toMatchObject({ tenantId: "t1", editMode: false });
  });

  it("returns null for a different tenantId (never leaks across tenants)", () => {
    startImpersonation({
      tenantId: "t1",
      tenantName: "Acme",
      adminEmail: "admin@heyloo.ai",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      editMode: false,
    });
    expect(readImpersonationState("t2")).toBeNull();
  });

  it("expires and clears itself once past expiresAt", () => {
    startImpersonation({
      tenantId: "t1",
      tenantName: "Acme",
      adminEmail: "admin@heyloo.ai",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      editMode: false,
    });
    expect(readImpersonationState("t1")).toBeNull();
  });

  it("setEditMode flips editMode without touching other fields", () => {
    startImpersonation({
      tenantId: "t1",
      tenantName: "Acme",
      adminEmail: "admin@heyloo.ai",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      editMode: false,
    });
    const updated = setEditMode("t1", true);
    expect(updated?.editMode).toBe(true);
    expect(readImpersonationState("t1")?.editMode).toBe(true);
  });

  it("setEditMode is a no-op when nothing is stored", () => {
    expect(setEditMode("t1", true)).toBeNull();
  });

  it("clearImpersonation removes the stored state", () => {
    startImpersonation({
      tenantId: "t1",
      tenantName: "Acme",
      adminEmail: "admin@heyloo.ai",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      editMode: false,
    });
    clearImpersonation();
    expect(readImpersonationState("t1")).toBeNull();
  });
});
