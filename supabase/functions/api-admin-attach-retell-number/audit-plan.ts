import type { InventoryBody, ResourceRef, TenantRef, UnreferencedAgent } from "./inventory.ts";

/**
 * RETELLCFG-REVIEW: the pure planning half of `scripts/retell/audit-config.ts`
 * (kept here, next to the inventory it reads, so it is typechecked and unit
 * tested with the rest of this package; the script only does I/O and
 * printing). Type-only imports, so Node's `--experimental-strip-types` can
 * load it from the script without pulling in zod.
 */

/** A tenant created by `api-admin-provision-test-tenant`: `test-*` slug, NOT
 * a signup test tenant (`tenants.is_test`), never through checkout (no Stripe
 * customer or subscription) and not canceled. The slug alone is not enough:
 * api-checkout slugs a real business called "Test Prep Co" as
 * `test-prep-co-<suffix>`. Unknown billing (null) is treated as billed. */
export function isProvisionTestTenant(ref: TenantRef): boolean {
  return (
    (ref.tenant_slug ?? "").startsWith("test-") &&
    ref.tenant_is_test !== true &&
    ref.tenant_has_billing === false &&
    ref.tenant_status !== "canceled"
  );
}

export function refLabel(ref: ResourceRef): string {
  if (ref.kind === "agent_configs") return `tenant ${ref.tenant_slug ?? ref.tenant_id}`;
  if (ref.kind === "platform_settings") return `platform_settings.${ref.key}`;
  return `secret ${ref.name}`;
}

export interface RepairStep {
  tenant: TenantRef;
  kind: "provision_test_tenant" | "republish_fleet" | "owner_portal_publish" | "reattach_number";
  body?: Record<string, unknown>;
  note: string;
}

/** The repair plan for every finding a CURRENT tenant owns. Only
 * `provision_test_tenant` and `reattach_number` steps for
 * `isProvisionTestTenant` tenants are ever executed by `--apply`. The
 * republish never asks for `cleanup_superseded_agent`: this tooling deletes
 * nothing, so the superseded agent shows up on the next cleanup list. */
export function buildRepairPlan(inv: InventoryBody, ownerEmail: string | undefined): RepairStep[] {
  const republish = new Map<string, TenantRef>();
  const reattach = new Map<string, TenantRef>();
  for (const f of inv.findings) {
    for (const owner of f.owners) {
      if (owner.kind !== "agent_configs") continue;
      if (f.recommended_action === "republish_tenant_agent") republish.set(owner.tenant_id, owner);
      if (f.recommended_action === "reattach_tenant_number") reattach.set(owner.tenant_id, owner);
    }
  }
  const steps: RepairStep[] = [];
  for (const tenant of republish.values()) {
    const slug = tenant.tenant_slug ?? "";
    if (isProvisionTestTenant(tenant)) {
      steps.push({
        tenant,
        kind: "provision_test_tenant",
        body: {
          vertical: tenant.tenant_vertical,
          name: tenant.tenant_name,
          slug,
          owner_email: ownerEmail ?? "<OWNER_EMAIL>",
          force_recompile: true,
        },
        note: "POST /functions/v1/api-admin-provision-test-tenant (recompiles with the configured URLs)",
      });
    } else if (tenant.tenant_is_test === true) {
      steps.push({
        tenant,
        kind: "republish_fleet",
        note: `node --experimental-strip-types scripts/republish-fleet.ts --tenant ${slug} --apply`,
      });
    } else {
      steps.push({
        tenant,
        kind: "owner_portal_publish",
        note: "real tenant: the owner clicks 'Publish changes' in the portal (api-tenant-agent-publish)",
      });
    }
    // A republish creates a NEW agent id; the tenant's number must follow it.
    reattach.set(tenant.tenant_id, tenant);
  }
  for (const tenant of reattach.values()) {
    const numbers = inv.phone_numbers.filter((n) => n.tenant_id === tenant.tenant_id);
    for (const n of numbers) {
      steps.push({
        tenant,
        kind: "reattach_number",
        body: { tenant_id: tenant.tenant_id, phone_e164: n.phone_number },
        note: "POST /functions/v1/api-admin-attach-retell-number (re-points inbound agent + inbound_webhook_url)",
      });
    }
  }
  return steps;
}

/** The steps `--apply` may execute: test-tenant republish and re-attach
 * only, and only for `isProvisionTestTenant` tenants. */
export function runnableSteps(steps: RepairStep[]): RepairStep[] {
  return steps.filter(
    (s) =>
      (s.kind === "provision_test_tenant" || s.kind === "reattach_number") &&
      isProvisionTestTenant(s.tenant),
  );
}

export function deleteHoldLabel(hold: UnreferencedAgent["delete_hold"]): string | null {
  switch (hold) {
    case "bound_to_tenant_number":
      return "DO NOT DELETE: answers a tenant's number (re-attach the number to the tenant's current agent; never unbind it)";
    case "bound_to_number":
      return "DO NOT DELETE YET: still bound to a number (unbind it first, only if nobody uses that number)";
    case "inventory_incomplete":
      return "DO NOT DELETE: the agent or number listing was partial; re-run the audit";
    default:
      return null;
  }
}
