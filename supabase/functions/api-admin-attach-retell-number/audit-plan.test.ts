import { describe, expect, it } from "vitest";
import {
  buildRepairPlan,
  deleteHoldLabel,
  isProvisionTestTenant,
  refLabel,
  runnableSteps,
} from "./audit-plan.ts";
import type { InventoryBody, InventoryFinding, TenantRef } from "./inventory.ts";

function tenant(overrides: Partial<TenantRef> = {}): TenantRef {
  return {
    kind: "agent_configs",
    tenant_id: "b2efae9d-8309-46d6-a950-31d683616cdc",
    tenant_slug: "test-riverside-auto",
    tenant_name: "Riverside Auto Repair (TEST)",
    tenant_vertical: "auto",
    tenant_is_test: false,
    tenant_status: "active",
    tenant_has_billing: false,
    ...overrides,
  };
}

function finding(owner: TenantRef, action: InventoryFinding["recommended_action"]) {
  return {
    severity: "high",
    kind: "legacy_function",
    resource_type: action === "reattach_tenant_number" ? "phone_number" : "conversation_flow",
    resource_id: "x",
    path: "tools[0].url",
    url: "https://example.supabase.co/functions/v1/retell-tools",
    function_name: "retell-tools",
    owners: [owner],
    recommended_action: action,
  } satisfies InventoryFinding;
}

function inventory(findings: InventoryFinding[], numbers: [string, string][]): InventoryBody {
  return {
    complete: true,
    cleanup_list_complete: true,
    errors: [],
    expected_urls: { voice_events: "", voice_tools: "", voice_inbound: "" },
    counts: {
      agents: 0,
      phone_numbers: numbers.length,
      retell_llms: 0,
      conversation_flows: 0,
      findings: findings.length,
      unreferenced_agents: 0,
    },
    findings,
    unreferenced_agents: [],
    orphan_retell_llm_ids: [],
    orphan_conversation_flow_ids: [],
    agents: [],
    phone_numbers: numbers.map(([phone, tenantId]) => ({
      phone_number: phone,
      nickname: null,
      phone_number_type: null,
      inbound_webhook_url: null,
      inbound_sms_webhook_url: null,
      inbound_agents: null,
      outbound_agents: null,
      inbound_sms_agents: null,
      outbound_sms_agents: null,
      tenant_id: tenantId,
    })),
    retell_llms: [],
    conversation_flows: [],
  };
}

describe("isProvisionTestTenant", () => {
  it("accepts only api-admin-provision-test-tenant tenants", () => {
    expect(isProvisionTestTenant(tenant())).toBe(true);
    // api-checkout slugs a real business called "Test Prep Co" as test-prep-co-<suffix>.
    expect(
      isProvisionTestTenant(tenant({ tenant_slug: "test-prep-co-4f2a", tenant_has_billing: true })),
    ).toBe(false);
    expect(isProvisionTestTenant(tenant({ tenant_has_billing: null }))).toBe(false);
    expect(isProvisionTestTenant(tenant({ tenant_is_test: true }))).toBe(false);
    expect(isProvisionTestTenant(tenant({ tenant_status: "canceled" }))).toBe(false);
    expect(isProvisionTestTenant(tenant({ tenant_slug: "signup-1-auto" }))).toBe(false);
    expect(isProvisionTestTenant(tenant({ tenant_slug: null }))).toBe(false);
  });
});

describe("buildRepairPlan / runnableSteps", () => {
  it("republishes a test tenant WITHOUT deleting the superseded agent, then re-attaches its number", () => {
    const t = tenant();
    const steps = buildRepairPlan(
      inventory([finding(t, "republish_tenant_agent")], [["+12602354330", t.tenant_id]]),
      "owner@example.com",
    );
    expect(steps.map((s) => s.kind)).toEqual(["provision_test_tenant", "reattach_number"]);
    expect(steps[0]?.body).toEqual({
      vertical: "auto",
      name: "Riverside Auto Repair (TEST)",
      slug: "test-riverside-auto",
      owner_email: "owner@example.com",
      force_recompile: true,
    });
    expect(steps[0]?.body).not.toHaveProperty("cleanup_superseded_agent");
    expect(steps[1]?.body).toEqual({ tenant_id: t.tenant_id, phone_e164: "+12602354330" });
    expect(runnableSteps(steps)).toEqual(steps);
  });

  it("never lets --apply touch a REAL tenant whose slug happens to start with test-", () => {
    const real = tenant({
      tenant_id: "11111111-1111-4111-8111-111111111111",
      tenant_slug: "test-prep-co-4f2a",
      tenant_has_billing: true,
    });
    const steps = buildRepairPlan(
      inventory(
        [finding(real, "republish_tenant_agent"), finding(real, "reattach_tenant_number")],
        [["+15551230000", real.tenant_id]],
      ),
      "owner@example.com",
    );
    expect(steps.map((s) => s.kind)).toEqual(["owner_portal_publish", "reattach_number"]);
    expect(runnableSteps(steps)).toEqual([]);
  });

  it("routes signup test tenants to republish-fleet and never runs them", () => {
    const signup = tenant({ tenant_slug: "signup-1-auto", tenant_is_test: true });
    const steps = buildRepairPlan(
      inventory([finding(signup, "republish_tenant_agent")], []),
      undefined,
    );
    expect(steps).toEqual([
      expect.objectContaining({
        kind: "republish_fleet",
        note: expect.stringContaining("--tenant signup-1-auto"),
      }),
    ]);
    expect(runnableSteps(steps)).toEqual([]);
  });
});

describe("labels", () => {
  it("names every reference kind", () => {
    expect(refLabel(tenant())).toBe("tenant test-riverside-auto");
    expect(refLabel({ kind: "platform_settings", key: "self_call_caller_agent" })).toBe(
      "platform_settings.self_call_caller_agent",
    );
    expect(refLabel({ kind: "env", name: "DEMO_AGENT_ID" })).toBe("secret DEMO_AGENT_ID");
  });

  it("says why a cleanup candidate must not be deleted", () => {
    expect(deleteHoldLabel(null)).toBeNull();
    expect(deleteHoldLabel("bound_to_tenant_number")).toMatch(/never unbind/);
    expect(deleteHoldLabel("bound_to_number")).toMatch(/unbind it first/);
    expect(deleteHoldLabel("inventory_incomplete")).toMatch(/re-run the audit/);
  });
});
