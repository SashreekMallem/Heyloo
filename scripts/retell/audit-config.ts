/**
 * RETELLCFG (docs/BUILD_NOTES.md): audits the whole Retell account through
 * `api-admin-attach-retell-number`'s read-only `action: "inventory"` and
 * prints:
 *
 *   1. every URL on an agent / retell-llm / conversation flow / phone number
 *      that points at a deleted legacy function (e.g. `retell-assistant`),
 *      a function this repo does not contain, another Supabase project, or
 *      the wrong one of our own endpoints — with who owns it;
 *   2. every agent WITHOUT an agent-level `webhook_url`: Retell sends those
 *      agents' call events to the ACCOUNT-level webhook set in the dashboard
 *      (docs.retellai.com/features/webhook-overview: "If set, the
 *      account-level webhook URL will not be triggered for that agent"), which
 *      has no API — see docs/GO_LIVE.md step 10 for the dashboard steps;
 *   3. the repair plan for anything a CURRENT tenant owns (recompile +
 *      republish the tenant's agent, re-attach its number), and
 *   4. the cleanup list: agents nothing references (no
 *      `agent_configs.retell_agent_id`, not inside any `platform_settings`
 *      value), oldest first, with name, approximate creation time and
 *      category. Nothing is ever deleted by this script.
 *
 * Dry-run by default: reads only. `--apply` executes ONLY the repair steps
 * for TEST tenants provisioned by `api-admin-provision-test-tenant` (slug
 * `test-*`, no Stripe customer or subscription, not a signup test tenant,
 * not canceled: `isProvisionTestTenant` in
 * supabase/functions/api-admin-attach-retell-number/audit-plan.ts):
 * force_recompile (WITHOUT cleanup_superseded_agent: this script never
 * causes a delete), then re-attach the tenant's number. Real tenants are
 * never touched, even one whose slug starts with `test-` (the owner
 * publishes from the portal); signup test tenants (`tenants.is_test`) are
 * printed as a `scripts/republish-fleet.ts` command.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co PROVISION_INTERNAL_SECRET=... \
 *     node --experimental-strip-types scripts/retell/audit-config.ts [--json out.json] [--apply]
 *
 * Required env:
 *   SUPABASE_URL                the project URL
 *   PROVISION_INTERNAL_SECRET   the `x-internal-secret` every api-admin-*
 *                               function checks (read from env only, never
 *                               printed)
 * Required only with --apply when a test tenant needs a republish:
 *   OWNER_EMAIL                 `api-admin-provision-test-tenant` requires an
 *                               `owner_email` (validated, not used for an
 *                               existing tenant)
 */

import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildRepairPlan,
  deleteHoldLabel,
  type RepairStep,
  refLabel,
  runnableSteps,
} from "../../supabase/functions/api-admin-attach-retell-number/audit-plan.ts";
import type {
  InventoryBody,
  InventoryFinding,
} from "../../supabase/functions/api-admin-attach-retell-number/inventory.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const jsonIndex = args.indexOf("--json");
const JSON_OUT = jsonIndex >= 0 ? (args[jsonIndex + 1] ?? null) : null;

const SUPABASE_URL = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
const OWNER_EMAIL = optionalEnv("OWNER_EMAIL");
const PROVISION_INTERNAL_SECRET = requireEnv("PROVISION_INTERNAL_SECRET");
const FUNCTIONS_DIR = fileURLToPath(new URL("../../supabase/functions/", import.meta.url));

async function callFunction(
  name: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": PROVISION_INTERNAL_SECRET },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // keep the raw text
  }
  return { status: res.status, body: parsed };
}

async function fetchInventory(): Promise<InventoryBody> {
  const res = await callFunction("api-admin-attach-retell-number", { action: "inventory" });
  const body = res.body as Partial<InventoryBody> | undefined;
  if (res.status !== 200 || !body || !Array.isArray(body.findings)) {
    console.error(
      `[retell-audit] inventory failed: HTTP ${res.status}. A 422 "invalid_tenant_id" means the ` +
        "deployed api-admin-attach-retell-number predates RETELLCFG (redeploy it first).",
    );
    console.error(JSON.stringify(res.body).slice(0, 1000));
    process.exit(1);
  }
  return body as InventoryBody;
}

function functionExistsInRepo(name: string): boolean {
  return existsSync(`${FUNCTIONS_DIR}${name}/index.ts`);
}

function ownerLabel(f: InventoryFinding): string {
  if (f.owners.length === 0) return "unreferenced";
  return f.owners.map(refLabel).join(", ");
}

function printFindings(inv: InventoryBody): void {
  console.log("\n=== 1. Stale / unexpected URLs, and tenant numbers bound to the wrong agent ===");
  const urlFindings = inv.findings.filter((f) => f.kind !== "account_webhook_fallback");
  if (urlFindings.length === 0) console.log("(none)");
  for (const f of urlFindings) {
    if (f.kind === "tenant_number_agent_mismatch") {
      const n = inv.phone_numbers.find((p) => p.phone_number === f.resource_id);
      console.log(
        `- [${f.severity}] ${f.kind} ${f.resource_id} inbound_agents=${JSON.stringify(n?.inbound_agents ?? null)} is not the tenant's current agent`,
      );
      console.log(`    owner: ${ownerLabel(f)}; action: ${f.recommended_action}`);
      continue;
    }
    const repo =
      f.function_name === null
        ? ""
        : functionExistsInRepo(f.function_name)
          ? " [function exists in repo]"
          : " [function NOT in repo -> 404]";
    console.log(
      `- [${f.severity}] ${f.kind} ${f.resource_type} ${f.resource_id} ${f.path ?? ""} -> ${f.url ?? ""}${repo}`,
    );
    console.log(`    owner: ${ownerLabel(f)}; action: ${f.recommended_action}`);
  }

  console.log(
    "\n=== 2. Agents without an agent-level webhook_url (events go to the ACCOUNT-level webhook) ===",
  );
  const fallback = inv.findings.filter((f) => f.kind === "account_webhook_fallback");
  if (fallback.length === 0) console.log("(none)");
  for (const f of fallback) {
    const agent = inv.agents.find((a) => a.agent_id === f.resource_id);
    const bound = agent?.bound_numbers.map((b) => `${b.direction} ${b.phone_number}`).join(", ");
    console.log(
      `- [${f.severity}] ${f.resource_id} "${agent?.agent_name ?? ""}" owner: ${ownerLabel(f)}${bound ? `; bound: ${bound}` : ""}`,
    );
  }
  if (fallback.length > 0) {
    console.log(
      "  -> These agents' call events are POSTed to whatever the Retell dashboard's account-level\n" +
        "     webhook holds (the live 404s at /functions/v1/retell-assistant). Clear it: docs/GO_LIVE.md step 10.",
    );
  }
}

function printPlan(steps: RepairStep[]): void {
  console.log("\n=== 3. Repair plan for resources owned by CURRENT tenants ===");
  if (steps.length === 0) {
    console.log(
      "(nothing to repair: no current tenant's agent, LLM, flow or number has a stale URL)",
    );
    return;
  }
  for (const s of steps) {
    console.log(`- ${s.tenant.tenant_slug ?? s.tenant.tenant_id}: ${s.kind} — ${s.note}`);
    if (s.body) console.log(`    body: ${JSON.stringify(s.body)}`);
  }
}

function printCleanup(inv: InventoryBody): void {
  console.log("\n=== 4. Unreferenced Retell agents (owner cleanup list — nothing deleted) ===");
  if (!inv.cleanup_list_complete) {
    console.log(
      "  !! PARTIAL inventory: the agent or phone-number listing did not complete. This is NOT a\n" +
        "     deletion list: a binding or reference may be missing. Delete nothing; re-run the audit.",
    );
  }
  if (inv.unreferenced_agents.length === 0) console.log("(none)");
  for (const a of inv.unreferenced_agents) {
    const bound = a.bound_numbers.map((b) => `${b.direction} ${b.phone_number}`).join(", ");
    const hold = deleteHoldLabel(a.delete_hold);
    console.log(
      `- created~${a.created_at_approx ?? "?"} modified ${a.user_modified_at ?? "?"} ${a.agent_id} "${a.agent_name ?? ""}" [${a.category}]${bound ? ` STILL BOUND: ${bound}` : ""}`,
    );
    if (hold) console.log(`    ${hold}`);
  }
  // Still referenced, but only by canceled tenants: job-offboarding releases
  // numbers, never agents, so these stay in Retell until the owner decides.
  const canceledOnly = inv.agents.filter(
    (a) =>
      a.referenced_by.length > 0 &&
      a.referenced_by.every((r) => r.kind === "agent_configs" && r.tenant_status === "canceled"),
  );
  for (const a of canceledOnly) {
    const slugs = a.referenced_by.map(refLabel).join(", ");
    console.log(
      `- (canceled tenant ${slugs}) ${a.agent_id} "${a.agent_name ?? ""}" — referenced only by a canceled tenant; owner decides`,
    );
  }
  if (inv.orphan_retell_llm_ids.length > 0 || inv.orphan_conversation_flow_ids.length > 0) {
    console.log(
      `  Response engines no agent uses: ${inv.orphan_retell_llm_ids.length} retell-llm(s), ` +
        `${inv.orphan_conversation_flow_ids.length} conversation flow(s) (ids in --json output).`,
    );
  }
}

function printOpenings(inv: InventoryBody): void {
  console.log("\n=== Referenced agents: language and opening ===");
  for (const a of inv.agents.filter((x) => x.referenced_by.length > 0)) {
    const engineId = a.response_engine?.id ?? null;
    const flow = inv.conversation_flows.find((f) => f.id === engineId);
    const llm = inv.retell_llms.find((l) => l.id === engineId);
    const opening = flow
      ? `start node ${flow.start_node?.id ?? "?"} (${flow.start_node?.instruction_type ?? "?"}): ${flow.start_node?.instruction_text ?? ""}`
      : llm
        ? `begin_message: ${llm.begin_message ?? "(unset: model-generated)"}`
        : "(engine not listed)";
    const who = a.referenced_by.map(refLabel).join(", ");
    console.log(
      `- ${who}: ${a.agent_id} language=${JSON.stringify(a.language)} voice=${a.voice_id ?? "?"} webhook=${a.webhook_url ?? "(none)"}`,
    );
    console.log(`    ${opening.slice(0, 300)}`);
  }
}

async function applyPlan(steps: RepairStep[]): Promise<void> {
  // Only tenants created by api-admin-provision-test-tenant (see
  // isProvisionTestTenant) are ever written to — never a real tenant.
  const runnable = runnableSteps(steps);
  for (const s of steps) {
    if (!runnable.includes(s)) {
      console.log(
        `[retell-audit] skip ${s.kind} for ${s.tenant.tenant_slug ?? s.tenant.tenant_id} (not an api-admin-provision-test-tenant tenant)`,
      );
    }
  }
  if (runnable.some((s) => s.kind === "provision_test_tenant") && !OWNER_EMAIL) {
    console.error("[retell-audit] --apply needs OWNER_EMAIL for api-admin-provision-test-tenant.");
    process.exit(1);
  }
  for (const s of runnable) {
    const slug = s.tenant.tenant_slug ?? "";
    const fn =
      s.kind === "provision_test_tenant"
        ? "api-admin-provision-test-tenant"
        : "api-admin-attach-retell-number";
    const res = await callFunction(fn, s.body ?? {});
    console.log(
      `[retell-audit] ${fn} ${slug}: HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`,
    );
    if (res.status >= 400) {
      console.error("[retell-audit] stopping at the first failure");
      process.exit(1);
    }
  }
}

async function main(): Promise<void> {
  const inv = await fetchInventory();
  console.log(
    `[retell-audit] agents=${inv.counts.agents} numbers=${inv.counts.phone_numbers} ` +
      `llms=${inv.counts.retell_llms} flows=${inv.counts.conversation_flows} ` +
      `findings=${inv.counts.findings} unreferenced_agents=${inv.counts.unreferenced_agents} complete=${inv.complete}`,
  );
  if (!inv.complete)
    console.log(`[retell-audit] PARTIAL result, errors: ${JSON.stringify(inv.errors)}`);
  if (JSON_OUT) {
    writeFileSync(JSON_OUT, `${JSON.stringify(inv, null, 2)}\n`);
    console.log(`[retell-audit] full inventory written to ${JSON_OUT}`);
  }
  printFindings(inv);
  const plan = buildRepairPlan(inv, OWNER_EMAIL);
  printPlan(plan);
  printCleanup(inv);
  printOpenings(inv);

  if (APPLY && plan.length > 0) {
    console.log("\n=== Applying test-tenant repairs ===");
    await applyPlan(plan);
    const after = await fetchInventory();
    const remaining = after.findings.filter(
      (f) =>
        f.recommended_action === "republish_tenant_agent" ||
        f.recommended_action === "reattach_tenant_number",
    );
    console.log(`[retell-audit] tenant-owned findings remaining after apply: ${remaining.length}`);
  }
}

main().catch((err: unknown) => {
  console.error("[retell-audit] failed:", err);
  process.exit(1);
});
