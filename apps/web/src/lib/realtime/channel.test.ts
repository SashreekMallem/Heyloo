import { describe, expect, it } from "vitest";
import { getTenantRealtimeChannelName } from "./channel";

describe("getTenantRealtimeChannelName", () => {
  it("matches the backend broadcast topic format ('tenant:' || tenant_id)", () => {
    expect(getTenantRealtimeChannelName("t1")).toBe("tenant:t1");
  });

  it("matches the RLS policy's topic expression for a real uuid", () => {
    const tenantId = "0d3f6b6a-6e2e-4a8a-9a8e-2f6a6b6a6e2e";
    expect(getTenantRealtimeChannelName(tenantId)).toBe(`tenant:${tenantId}`);
  });
});
