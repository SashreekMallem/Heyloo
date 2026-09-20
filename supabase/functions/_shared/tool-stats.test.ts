import { describe, expect, it } from "vitest";
import type { ToolCall } from "./schemas/voice-tools.ts";
import { resolveTelemetryTenantId } from "./tool-stats.ts";

/**
 * OPS-5 (docs/BUILD_NOTES.md): unit coverage for the `tool_health`
 * attribution fix — dental showed zero rows because every Retell
 * batch-test call shares the literal `call_id` "playground", so
 * `voice-tools/context.ts`'s cached `call_logs` lookup permanently
 * returns whichever tenant happened to run the first-ever batch test
 * against that id, not the tenant actually under test. See
 * `resolveTelemetryTenantId`'s own docstring in tool-stats.ts for the
 * full root-cause writeup.
 */
describe("resolveTelemetryTenantId", () => {
  it("prefers the per-call heyloo_tenant_id dynamic variable when present (batch-test path)", () => {
    const call: ToolCall = {
      call_id: "playground",
      retell_llm_dynamic_variables: { heyloo_tenant_id: "dental_tenant" },
    };
    // The resolved ctx.tenantId is a DIFFERENT (stale/collided) tenant —
    // the dynamic variable must win.
    expect(resolveTelemetryTenantId("auto_tenant", call)).toBe("dental_tenant");
  });

  it("falls back to the resolved tenantId when no dynamic variable is set (real-call path, unchanged)", () => {
    const call: ToolCall = { call_id: "call_real_1" };
    expect(resolveTelemetryTenantId("real_tenant", call)).toBe("real_tenant");
  });

  it("falls back to the resolved tenantId when call is undefined", () => {
    expect(resolveTelemetryTenantId("real_tenant", undefined)).toBe("real_tenant");
  });

  it("falls back to the resolved tenantId when the dynamic variable is present but not a string", () => {
    const call: ToolCall = {
      call_id: "playground",
      retell_llm_dynamic_variables: { heyloo_tenant_id: 12345 },
    };
    expect(resolveTelemetryTenantId("auto_tenant", call)).toBe("auto_tenant");
  });

  it("returns null when neither source has a tenant (unresolved call, unchanged behavior)", () => {
    expect(resolveTelemetryTenantId(null, undefined)).toBeNull();
  });
});
