import { z } from "zod";
import type { RetellFetch, RetellListPageOptions } from "../_shared/providers/retell.ts";
import {
  getAgentVersion,
  getChatAgentVersion,
  listAgentsPage,
  listAgentVersions,
  listConversationFlowsPage,
  listPhoneNumbersPage,
  listRetellLLMsPage,
} from "../_shared/providers/retell.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import {
  classifyUrl,
  collectUrls,
  describeBeginMessage,
  describeLanguage,
  describeStartNode,
  describeStartSpeaker,
  type ExpectedRetellUrls,
  expectedUrlForField,
  type RetellResourceType,
  redactUrlOrNull,
  type StartNodeSummary,
  type UrlClassification,
} from "./retell-summaries.ts";

/**
 * `action: "inventory"` (RETELLCFG, docs/BUILD_NOTES.md): a READ-ONLY dump of
 * every agent, phone number, retell-llm and conversation flow in the Retell
 * account, with every URL each one would call (agent `webhook_url`, custom
 * tool `url`, MCP `url`, phone `inbound_webhook_url` /
 * `inbound_sms_webhook_url`, and any URL embedded in prompt / code text),
 * classified against the endpoints this platform actually configures.
 * Header / query-param VALUES and SIP credentials are never read into the
 * output, and every URL has its credentials and query values redacted.
 *
 * Why it exists: VERIFY-DEPLOY saw every live PSTN call POST ~8 times to the
 * deleted legacy `/functions/v1/retell-assistant` (404). Retell sends an
 * agent's call events to its agent-level `webhook_url`, and ONLY when that is
 * unset, to the account-level webhook configured in the dashboard
 * (docs.retellai.com/features/webhook-overview: "If set, the account-level
 * webhook URL will not be triggered for that agent"). The account-level
 * setting has no API, so this action cannot read it directly; it instead
 * lists every agent WITHOUT a `webhook_url` (`account_webhook_fallback`
 * findings) — those are the agents whose events reach whatever the dashboard
 * holds — plus every stale URL on agents / LLMs / flows / numbers.
 *
 * Also answers "which Retell agents does nothing reference?": an agent is
 * referenced when its id is some tenant's `agent_configs.retell_agent_id` or
 * appears anywhere inside a `platform_settings` value (the self-call caller
 * agent lives at `platform_settings.self_call_caller_agent`). Unreferenced
 * agents come back with a name-based category and the earliest version's
 * modification time (Retell exposes no creation timestamp) as a cleanup
 * list. Nothing is ever mutated or deleted.
 *
 * Cross-tenant by design (it inventories the one shared Retell account), so
 * it is only reachable behind `x-internal-secret` (index.ts) and returns
 * tenant ids / slugs, never tenant data.
 */

export interface InventoryDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  logger: Logger;
  expected: ExpectedRetellUrls;
  /** Lower-cased host of this Supabase project, e.g. `<ref>.supabase.co`. */
  projectHost: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Wall-clock budget for the whole action. Supabase's request idle timeout
   * is 150 s (supabase.com/docs/guides/functions/limits); default 100 s. */
  budgetMs?: number;
  /** Parallel per-agent Retell calls (default 4). */
  concurrency?: number;
  /** Safety cap on list pages per resource type (default 20 x 1000 items). */
  maxPages?: number;
  /** Per-attempt timeout for one Retell request (default 20 s, never more
   * than what is left of `budgetMs`). Without it one hung connection would
   * outlive the budget and Supabase's 150 s request limit would kill the
   * function with no partial result (RETELLCFG-REVIEW). */
  requestTimeoutMs?: number;
  /** Agent / LLM ids that deployment configuration (secrets) points at, by
   * variable name, e.g. `{ DEMO_AGENT_ID: "agent_..." }`. They are live
   * references exactly like `agent_configs` rows, so they must never land
   * on the cleanup list (RETELLCFG-REVIEW: the public demo agent is
   * referenced ONLY by the `DEMO_AGENT_ID` secret). */
  envReferences?: Record<string, string | null | undefined>;
}

export interface TenantRef {
  kind: "agent_configs";
  tenant_id: string;
  tenant_slug: string | null;
  tenant_name: string | null;
  tenant_vertical: string | null;
  tenant_is_test: boolean | null;
  tenant_status: string | null;
  /** True when the tenant has a Stripe customer or subscription, i.e. it
   * went through real checkout. Test tenants created by
   * `api-admin-provision-test-tenant` never do (RETELLCFG-REVIEW: a real
   * business named "Test ..." gets a `test-...` slug from api-checkout, so
   * the slug alone cannot identify a test tenant). */
  tenant_has_billing: boolean | null;
}

export interface PlatformSettingRef {
  kind: "platform_settings";
  key: string;
}

/** A deployment secret whose value is this resource's id (e.g. `DEMO_AGENT_ID`). */
export interface EnvRef {
  kind: "env";
  name: string;
}

export type ResourceRef = TenantRef | PlatformSettingRef | EnvRef;

export interface NumberBinding {
  phone_number: string;
  direction: "inbound" | "outbound" | "inbound_sms" | "outbound_sms";
}

export interface InventoryAgent {
  agent_id: string;
  agent_name: string | null;
  channel: string | null;
  user_modified_at: string | null;
  /** The version whose settings are reported below: the latest PUBLISHED
   * version when one exists, otherwise the latest draft. */
  version: number | null;
  is_published: boolean | null;
  /** Set when the latest version is an unpublished draft newer than
   * `version` (its URLs are scanned too). */
  draft_version: number | null;
  webhook_url: string | null;
  webhook_events: unknown;
  webhook_timeout_ms: number | null;
  language: string | string[] | null;
  voice_id: string | null;
  response_engine: { type: string | null; id: string | null } | null;
  referenced_by: ResourceRef[];
  bound_numbers: NumberBinding[];
  created_at_approx: string | null;
  detail_error: string | null;
}

export interface InventoryPhoneNumber {
  phone_number: string;
  nickname: string | null;
  phone_number_type: string | null;
  inbound_webhook_url: string | null;
  inbound_sms_webhook_url: string | null;
  inbound_agents: unknown;
  outbound_agents: unknown;
  inbound_sms_agents: unknown;
  outbound_sms_agents: unknown;
  /** Tenant owning this number in `phone_numbers` (unreleased), if any. */
  tenant_id: string | null;
}

export interface InventoryEngine {
  id: string;
  version: number | null;
  is_published: boolean | null;
  modified_at: string | null;
  start_speaker: string | null;
  used_by_agents: string[];
  referenced_by: ResourceRef[];
  urls: { path: string; url: string; classification: UrlClassification }[];
}

export interface InventoryLlm extends InventoryEngine {
  begin_message: string | null;
}

export interface InventoryFlow extends InventoryEngine {
  start_node: StartNodeSummary | null;
}

export type FindingKind =
  | "account_webhook_fallback"
  /** A number `phone_numbers` assigns to a tenant is not answered by that
   * tenant's current `agent_configs.retell_agent_id` in Retell (a missed
   * re-attach after a republish): the old agent is still serving the
   * tenant's calls, so it must be re-attached, never unbound. */
  | "tenant_number_agent_mismatch"
  | UrlClassification;

export interface InventoryFinding {
  severity: "high" | "medium" | "low";
  kind: FindingKind;
  resource_type: RetellResourceType;
  resource_id: string;
  path: string | null;
  url: string | null;
  function_name: string | null;
  /** Who owns the resource: the tenants / platform settings referencing it
   * (directly, or through an agent that uses the LLM / flow / number). Empty
   * when nothing in the database references it. */
  owners: ResourceRef[];
  recommended_action:
    | "republish_tenant_agent"
    | "reattach_tenant_number"
    | "clear_account_level_webhook"
    | "owner_cleanup_candidate"
    | "review";
}

export interface UnreferencedAgent {
  agent_id: string;
  agent_name: string | null;
  created_at_approx: string | null;
  user_modified_at: string | null;
  category:
    | "superseded_tenant_agent"
    | "orphan_tenant_agent"
    | "template_publish_agent"
    | "superseded_self_call_caller"
    | "unrecognized";
  /** Non-empty = still bound to a number (voice or SMS). */
  bound_numbers: NumberBinding[];
  webhook_url: string | null;
  /** Null = safe to delete as far as this inventory can tell. Otherwise why
   * it must NOT be deleted yet: `bound_to_tenant_number` (it answers a
   * tenant's number: re-attach the number to the tenant's current agent,
   * never unbind it), `bound_to_number` (unbind first),
   * `inventory_incomplete` (the agent or number listing was partial, so a
   * binding or reference may be missing). */
  delete_hold: "bound_to_tenant_number" | "bound_to_number" | "inventory_incomplete" | null;
}

export interface InventoryBody {
  complete: boolean;
  /** True only when the agent AND phone-number listings were read in full,
   * so `unreferenced_agents` and every binding on it can be trusted. */
  cleanup_list_complete: boolean;
  errors: { step: string; status: number | null; detail: string }[];
  expected_urls: ExpectedRetellUrls;
  counts: {
    agents: number;
    phone_numbers: number;
    retell_llms: number;
    conversation_flows: number;
    findings: number;
    unreferenced_agents: number;
  };
  findings: InventoryFinding[];
  unreferenced_agents: UnreferencedAgent[];
  orphan_retell_llm_ids: string[];
  orphan_conversation_flow_ids: string[];
  agents: InventoryAgent[];
  phone_numbers: InventoryPhoneNumber[];
  retell_llms: InventoryLlm[];
  conversation_flows: InventoryFlow[];
}

export interface InventoryResult {
  status: number;
  body: InventoryBody | { error: string };
}

// ---------------------------------------------------------------------------
// Boundary validation (CLAUDE.md Rule 1: runtime validator on the provider
// boundary). Loose objects: unknown fields are kept, only what this action
// reads is typed.
// ---------------------------------------------------------------------------

const ListEnvelopeSchema = z
  .object({
    items: z.array(z.record(z.string(), z.unknown())),
    has_more: z.boolean().optional(),
    pagination_key: z.string().nullish(),
  })
  .passthrough();

const AgentListItemSchema = z
  .object({
    agent_id: z.string().min(1),
    agent_name: z.string().nullish(),
    channel: z.string().nullish(),
    user_modified_timestamp: z.number().nullish(),
  })
  .passthrough();

const AgentDetailSchema = z
  .object({
    agent_id: z.string().optional(),
    version: z.number().nullish(),
    is_published: z.boolean().nullish(),
    webhook_url: z.string().nullish(),
    webhook_events: z.unknown().optional(),
    webhook_timeout_ms: z.number().nullish(),
    voice_id: z.string().nullish(),
    response_engine: z
      .object({
        type: z.string().nullish(),
        llm_id: z.string().nullish(),
        conversation_flow_id: z.string().nullish(),
        llm_websocket_url: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const PhoneNumberItemSchema = z
  .object({
    phone_number: z.string().min(1),
    nickname: z.string().nullish(),
    phone_number_type: z.string().nullish(),
    inbound_webhook_url: z.string().nullish(),
    inbound_sms_webhook_url: z.string().nullish(),
    inbound_agents: z.unknown().optional(),
    outbound_agents: z.unknown().optional(),
    inbound_sms_agents: z.unknown().optional(),
    outbound_sms_agents: z.unknown().optional(),
  })
  .passthrough();

const EngineItemSchema = z
  .object({
    version: z.number().nullish(),
    is_published: z.boolean().nullish(),
    last_modification_timestamp: z.number().nullish(),
  })
  .passthrough();

const AgentVersionItemSchema = z
  .object({ last_modification_timestamp: z.number().nullish() })
  .passthrough();

type AgentDetail = z.infer<typeof AgentDetailSchema>;

function isoOrNull(ms: number | null | undefined): string | null {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** One Retell request, given the (timeout-wrapped) fetch to use. */
type RetellCall = (
  fetchImpl: RetellFetch,
) => Promise<{ ok: boolean; status: number; body: unknown }>;

class BudgetExceeded extends Error {}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

const AGENT_NAME_TENANT = /^heyloo-(?:test-)?tenant-([0-9a-f-]{36})$/i;
const SELF_CALL_CALLER_AGENT_NAME = "Heyloo Self-Call Test Caller";

function extractIds(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    if (/^(agent|llm|conversation_flow)_[0-9a-z]+$/i.test(value)) into.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) extractIds(v, into);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value)) extractIds(v, into);
  }
}

function agentWeightIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((w) =>
      typeof w === "object" && w !== null ? (w as Record<string, unknown>)["agent_id"] : null,
    )
    .filter((id): id is string => typeof id === "string");
}

export async function inventoryRetellAccount(
  sql: SqlClient,
  deps: InventoryDeps,
): Promise<InventoryResult> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + (deps.budgetMs ?? 100_000);
  const concurrency = deps.concurrency ?? 4;
  const maxPages = deps.maxPages ?? 20;
  const requestTimeoutMs = deps.requestTimeoutMs ?? 20_000;
  const errors: InventoryBody["errors"] = [];
  let complete = true;
  // The cleanup list is only as good as the agent and number listings.
  let agentsListed = true;
  let numbersListed = true;

  /** One Retell call with a bounded retry on 429 / 5xx / network error /
   * timeout. Each attempt is aborted after `requestTimeoutMs` or when the
   * budget runs out, whichever is first. */
  const call = async (step: string, fn: RetellCall) => {
    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new BudgetExceeded(step);
      const timeoutMs = Math.max(1, Math.min(requestTimeoutMs, remaining));
      const timedFetch: RetellFetch = (input, init) =>
        deps.retellFetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      try {
        const res = await fn(timedFetch);
        if ((res.status === 429 || res.status >= 500) && attempt < 2) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        return res;
      } catch (err) {
        if (err instanceof BudgetExceeded) throw err;
        if (attempt < 2) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        return { ok: false, status: 0, body: { error: String(err) } };
      }
    }
  };

  const listAll = async (
    step: string,
    page: (fetchImpl: RetellFetch, opts: RetellListPageOptions) => ReturnType<RetellCall>,
  ): Promise<Record<string, unknown>[]> => {
    const items: Record<string, unknown>[] = [];
    let paginationKey: string | undefined;
    for (let i = 0; i < maxPages; i++) {
      const res = await call(step, (f) =>
        page(f, paginationKey ? { limit: 1000, paginationKey } : { limit: 1000 }),
      );
      const parsed = ListEnvelopeSchema.safeParse(res.body);
      if (!res.ok || !parsed.success) {
        complete = false;
        errors.push({
          step,
          status: res.status,
          detail: res.ok ? "unexpected_response_shape" : "retell_error",
        });
        deps.logger.error("retell_inventory_list_failed", { step, status: res.status });
        markListIncomplete(step);
        return items;
      }
      items.push(...parsed.data.items);
      if (!parsed.data.has_more || !parsed.data.pagination_key) return items;
      paginationKey = parsed.data.pagination_key;
    }
    complete = false;
    errors.push({ step, status: null, detail: "max_pages_reached" });
    markListIncomplete(step);
    return items;
  };

  // --- database references -------------------------------------------------
  const tenantRows = await sql<{
    tenant_id: string;
    retell_agent_id: string | null;
    retell_llm_id: string | null;
    slug: string | null;
    name: string | null;
    vertical: string | null;
    is_test: boolean | null;
    status: string | null;
    has_billing: boolean | null;
  }>`
    select ac.tenant_id, ac.retell_agent_id, ac.retell_llm_id,
      t.slug, t.name, t.vertical, t.is_test, t.status,
      (t.stripe_customer_id is not null or t.stripe_subscription_id is not null) as has_billing
    from public.agent_configs ac
    join public.tenants t on t.id = ac.tenant_id
  `;
  const settingRows = await sql<{ key: string; value: unknown }>`
    select key, value from public.platform_settings
  `;
  const numberRows = await sql<{ e164: string; tenant_id: string }>`
    select e164, tenant_id from public.phone_numbers where released_at is null
  `;

  const refsById = new Map<string, ResourceRef[]>();
  const addRef = (id: string | null | undefined, ref: ResourceRef) => {
    if (!id) return;
    const list = refsById.get(id) ?? [];
    list.push(ref);
    refsById.set(id, list);
  };
  const knownTenantIds = new Set<string>();
  const tenantRefById = new Map<string, TenantRef>();
  for (const row of tenantRows) {
    knownTenantIds.add(row.tenant_id);
    const ref: TenantRef = {
      kind: "agent_configs",
      tenant_id: row.tenant_id,
      tenant_slug: row.slug,
      tenant_name: row.name,
      tenant_vertical: row.vertical,
      tenant_is_test: row.is_test,
      tenant_status: row.status,
      tenant_has_billing: row.has_billing,
    };
    tenantRefById.set(row.tenant_id, ref);
    addRef(row.retell_agent_id, ref);
    addRef(row.retell_llm_id, ref);
  }
  for (const row of settingRows) {
    const ids = new Set<string>();
    extractIds(row.value, ids);
    for (const id of ids) addRef(id, { kind: "platform_settings", key: row.key });
  }
  for (const [name, value] of Object.entries(deps.envReferences ?? {})) {
    const id = value?.trim();
    if (id) addRef(id, { kind: "env", name });
  }
  const currentAgentByTenant = new Map(
    tenantRows
      .filter((r) => r.retell_agent_id)
      .map((r) => [r.tenant_id, r.retell_agent_id as string]),
  );
  const tenantByNumber = new Map(numberRows.map((r) => [r.e164, r.tenant_id]));

  const markListIncomplete = (step: string) => {
    if (step === "list_agents") agentsListed = false;
    if (step === "list_phone_numbers") numbersListed = false;
  };

  const findings: InventoryFinding[] = [];
  const agents: InventoryAgent[] = [];
  const phoneNumbers: InventoryPhoneNumber[] = [];
  const llms: InventoryLlm[] = [];
  const flows: InventoryFlow[] = [];
  const unreferenced: UnreferencedAgent[] = [];

  const bindingsByAgent = new Map<string, NumberBinding[]>();
  const numberOwners = new Map<string, string[]>();
  const engineUsers = new Map<string, string[]>();
  const ownersOfEngine = (id: string): ResourceRef[] => {
    const owners = [...(refsById.get(id) ?? [])];
    for (const agentId of engineUsers.get(id) ?? []) owners.push(...(refsById.get(agentId) ?? []));
    return dedupeRefs(owners);
  };
  /** A number's owners: the tenant `phone_numbers` assigns it to, plus the
   * owners of every agent bound to it in Retell. */
  const phoneOwners = (e164: string): ResourceRef[] => {
    const owners: ResourceRef[] = [];
    const tenantId = tenantByNumber.get(e164);
    const tenantRef = tenantId ? tenantRefById.get(tenantId) : undefined;
    if (tenantRef) owners.push(tenantRef);
    for (const agentId of numberOwners.get(e164) ?? [])
      owners.push(...(refsById.get(agentId) ?? []));
    return dedupeRefs(owners);
  };
  const scanResource = (
    type: RetellResourceType,
    id: string,
    resource: unknown,
    engine: InventoryEngine | null,
  ): void => {
    for (const found of collectUrls(resource)) {
      const expectedForField = expectedUrlForField(type, found.path, deps.expected);
      const { classification, function_name } = classifyUrl(found.url, {
        projectHost: deps.projectHost,
        expected: deps.expected,
        expectedForField,
      });
      if (engine) engine.urls.push({ path: found.path, url: found.url, classification });
      const isFinding =
        classification !== "expected" &&
        (classification !== "external" || expectedForField !== null);
      if (!isFinding) continue;
      if (
        findings.some(
          (f) =>
            f.resource_type === type &&
            f.resource_id === id &&
            f.path === found.path &&
            f.url === found.url,
        )
      ) {
        continue;
      }
      const owners =
        type === "agent"
          ? (refsById.get(id) ?? [])
          : type === "phone_number"
            ? phoneOwners(id)
            : ownersOfEngine(id);
      findings.push({
        severity:
          classification === "legacy_function" ||
          classification === "unexpected_project_function" ||
          classification === "other_supabase_project"
            ? "high"
            : "medium",
        kind: classification,
        resource_type: type,
        resource_id: id,
        path: found.path,
        url: found.url,
        function_name,
        owners,
        recommended_action: "review",
      });
    }
  };

  try {
    // --- account listings --------------------------------------------------
    const [agentItems, numberItems, llmItems, flowItems] = [
      await listAll("list_agents", (f, o) => listAgentsPage(f, deps.retellApiKey, o)),
      await listAll("list_phone_numbers", (f, o) => listPhoneNumbersPage(f, deps.retellApiKey, o)),
      await listAll("list_retell_llms", (f, o) => listRetellLLMsPage(f, deps.retellApiKey, o)),
      await listAll("list_conversation_flows", (f, o) =>
        listConversationFlowsPage(f, deps.retellApiKey, o),
      ),
    ];

    // --- phone numbers ------------------------------------------------------
    for (const raw of numberItems) {
      const parsed = PhoneNumberItemSchema.safeParse(raw);
      if (!parsed.success) {
        complete = false;
        numbersListed = false;
        errors.push({ step: "parse_phone_number", status: null, detail: "unexpected_item_shape" });
        continue;
      }
      const n = parsed.data;
      // Voice AND SMS bindings (list-phone-numbers documents
      // `inbound_sms_agents` / `outbound_sms_agents` alongside the voice
      // ones): an agent bound by either is in use.
      const bindings: [NumberBinding["direction"], string[]][] = [
        ["inbound", agentWeightIds(n.inbound_agents)],
        ["outbound", agentWeightIds(n.outbound_agents)],
        ["inbound_sms", agentWeightIds(n.inbound_sms_agents)],
        ["outbound_sms", agentWeightIds(n.outbound_sms_agents)],
      ];
      for (const [direction, ids] of bindings) {
        for (const id of ids) {
          bindingsByAgent.set(id, [
            ...(bindingsByAgent.get(id) ?? []),
            { phone_number: n.phone_number, direction },
          ]);
        }
      }
      numberOwners.set(
        n.phone_number,
        bindings.flatMap(([, ids]) => ids),
      );
      const ownerTenantId = tenantByNumber.get(n.phone_number) ?? null;
      phoneNumbers.push({
        phone_number: n.phone_number,
        nickname: n.nickname ?? null,
        phone_number_type: n.phone_number_type ?? null,
        inbound_webhook_url: redactUrlOrNull(n.inbound_webhook_url),
        inbound_sms_webhook_url: redactUrlOrNull(n.inbound_sms_webhook_url),
        inbound_agents: n.inbound_agents ?? null,
        outbound_agents: n.outbound_agents ?? null,
        inbound_sms_agents: n.inbound_sms_agents ?? null,
        outbound_sms_agents: n.outbound_sms_agents ?? null,
        tenant_id: ownerTenantId,
      });
      // A tenant's number must be answered by that tenant's CURRENT agent.
      const currentAgent = ownerTenantId ? currentAgentByTenant.get(ownerTenantId) : undefined;
      const inboundIds = bindings[0]?.[1] ?? [];
      const ownerRef = ownerTenantId ? tenantRefById.get(ownerTenantId) : undefined;
      if (
        currentAgent &&
        ownerRef &&
        (inboundIds.length === 0 || inboundIds.some((id) => id !== currentAgent))
      ) {
        findings.push({
          severity: "high",
          kind: "tenant_number_agent_mismatch",
          resource_type: "phone_number",
          resource_id: n.phone_number,
          path: "inbound_agents",
          url: null,
          function_name: null,
          owners: [ownerRef],
          recommended_action: "reattach_tenant_number",
        });
      }
    }

    // --- agents (list-agents is a summary; details need get-agent) ----------
    const agentSummaries = agentItems
      .map((raw) => AgentListItemSchema.safeParse(raw))
      .filter((p) => {
        if (!p.success) {
          complete = false;
          agentsListed = false;
          errors.push({ step: "parse_agent", status: null, detail: "unexpected_item_shape" });
        }
        return p.success;
      })
      .map((p) => (p.success ? p.data : null))
      .filter((a): a is z.infer<typeof AgentListItemSchema> => a !== null);

    const agentDetails = await mapWithConcurrency(agentSummaries, concurrency, async (summary) => {
      const out: {
        latest: AgentDetail | null;
        published: AgentDetail | null;
        error: string | null;
      } = { latest: null, published: null, error: null };
      if (now() > deadline) {
        out.error = "skipped_budget_exhausted";
        return out;
      }
      // `/v2/list-agents` returns voice AND chat agents; a chat agent's
      // details live under `/get-chat-agent` (same `version` values).
      const getDetail = summary.channel === "chat" ? getChatAgentVersion : getAgentVersion;
      try {
        const latest = await call("get_agent", (f) =>
          getDetail(f, deps.retellApiKey, summary.agent_id, "latest"),
        );
        const parsed = AgentDetailSchema.safeParse(latest.body);
        if (!latest.ok || !parsed.success) {
          out.error = latest.ok ? "unexpected_response_shape" : `retell_status_${latest.status}`;
          return out;
        }
        out.latest = parsed.data;
        if (parsed.data.is_published === false) {
          const pub = await call("get_agent_published", (f) =>
            getDetail(f, deps.retellApiKey, summary.agent_id, "latest_published"),
          );
          const pubParsed = AgentDetailSchema.safeParse(pub.body);
          if (pub.ok && pubParsed.success) out.published = pubParsed.data;
        }
      } catch (err) {
        if (!(err instanceof BudgetExceeded)) throw err;
        out.error = "skipped_budget_exhausted";
      }
      return out;
    });

    agentSummaries.forEach((summary, i) => {
      const detail = agentDetails[i] ?? { latest: null, published: null, error: "missing" };
      const serving = detail.published ?? detail.latest;
      const referencedBy = refsById.get(summary.agent_id) ?? [];
      const engine = serving?.response_engine ?? null;
      const engineId = engine?.conversation_flow_id ?? engine?.llm_id ?? null;
      for (const d of [detail.latest, detail.published]) {
        const eid = d?.response_engine?.conversation_flow_id ?? d?.response_engine?.llm_id;
        if (eid) {
          const users = engineUsers.get(eid) ?? [];
          if (!users.includes(summary.agent_id)) users.push(summary.agent_id);
          engineUsers.set(eid, users);
        }
      }
      if (detail.error) {
        complete = false;
        errors.push({ step: `get_agent:${summary.agent_id}`, status: null, detail: detail.error });
      }
      agents.push({
        agent_id: summary.agent_id,
        agent_name: summary.agent_name ?? null,
        channel: summary.channel ?? null,
        user_modified_at: isoOrNull(summary.user_modified_timestamp),
        version: serving?.version ?? null,
        is_published: serving?.is_published ?? null,
        draft_version:
          detail.published && detail.latest && detail.latest.version !== detail.published.version
            ? (detail.latest.version ?? null)
            : null,
        webhook_url: redactUrlOrNull(serving?.webhook_url),
        webhook_events: serving?.webhook_events ?? null,
        webhook_timeout_ms: serving?.webhook_timeout_ms ?? null,
        language: describeLanguage(serving),
        voice_id: serving?.voice_id ?? null,
        response_engine: engine ? { type: engine.type ?? null, id: engineId } : null,
        referenced_by: referencedBy,
        bound_numbers: bindingsByAgent.get(summary.agent_id) ?? [],
        created_at_approx: null,
        detail_error: detail.error,
      });
    });

    // --- engines ------------------------------------------------------------
    const pickLatest = (items: Record<string, unknown>[], idKey: string) => {
      const byId = new Map<string, Record<string, unknown>>();
      for (const item of items) {
        const id = item[idKey];
        if (typeof id !== "string") continue;
        const prev = byId.get(id);
        const v = EngineItemSchema.safeParse(item).data?.version ?? -1;
        const pv = prev ? (EngineItemSchema.safeParse(prev).data?.version ?? -1) : -2;
        if (v > pv) byId.set(id, item);
      }
      return byId;
    };
    for (const [id, item] of pickLatest(llmItems, "llm_id")) {
      const meta = EngineItemSchema.safeParse(item).data;
      llms.push({
        id,
        version: meta?.version ?? null,
        is_published: meta?.is_published ?? null,
        modified_at: isoOrNull(meta?.last_modification_timestamp),
        start_speaker: describeStartSpeaker(item),
        begin_message: describeBeginMessage(item),
        used_by_agents: engineUsers.get(id) ?? [],
        referenced_by: ownersOfEngine(id),
        urls: [],
      });
      scanResource("retell_llm", id, item, llms[llms.length - 1] as InventoryLlm);
    }
    for (const [id, item] of pickLatest(flowItems, "conversation_flow_id")) {
      const meta = EngineItemSchema.safeParse(item).data;
      flows.push({
        id,
        version: meta?.version ?? null,
        is_published: meta?.is_published ?? null,
        modified_at: isoOrNull(meta?.last_modification_timestamp),
        start_speaker: describeStartSpeaker(item),
        start_node: describeStartNode(item),
        used_by_agents: engineUsers.get(id) ?? [],
        referenced_by: ownersOfEngine(id),
        urls: [],
      });
      scanResource("conversation_flow", id, item, flows[flows.length - 1] as InventoryFlow);
    }

    // --- agent / number URL findings ----------------------------------------
    agentSummaries.forEach((summary, i) => {
      const detail = agentDetails[i];
      const inv = agents[i] as InventoryAgent;
      for (const d of [detail?.published ?? null, detail?.latest ?? null]) {
        if (d) scanResource("agent", summary.agent_id, d, null);
      }
      const serving = detail?.published ?? detail?.latest ?? null;
      if (serving && !serving.webhook_url) {
        const owned = inv.referenced_by.length > 0 || inv.bound_numbers.length > 0;
        findings.push({
          severity: owned ? "high" : "low",
          kind: "account_webhook_fallback",
          resource_type: "agent",
          resource_id: summary.agent_id,
          path: "webhook_url",
          url: null,
          function_name: null,
          owners: inv.referenced_by,
          recommended_action: "clear_account_level_webhook",
        });
      }
    });
    for (const raw of numberItems) {
      const id = typeof raw["phone_number"] === "string" ? raw["phone_number"] : null;
      if (!id) continue;
      scanResource("phone_number", id, raw, null);
    }

    // --- unreferenced agents (cleanup list) ---------------------------------
    const unrefAgents = agents.filter((a) => a.referenced_by.length === 0);
    const created = await mapWithConcurrency(unrefAgents, concurrency, async (a) => {
      if (now() > deadline) return null;
      try {
        const res = await call("list_agent_versions", (f) =>
          listAgentVersions(f, deps.retellApiKey, a.agent_id, {
            limit: 1,
            sortOrder: "ascending",
          }),
        );
        const env = ListEnvelopeSchema.safeParse(res.body);
        if (!res.ok || !env.success) return null;
        const first = AgentVersionItemSchema.safeParse(env.data.items[0] ?? {});
        return isoOrNull(first.data?.last_modification_timestamp);
      } catch (err) {
        if (!(err instanceof BudgetExceeded)) throw err;
        return null;
      }
    });
    unrefAgents.forEach((a, i) => {
      a.created_at_approx = created[i] ?? null;
      const deleteHold: UnreferencedAgent["delete_hold"] = a.bound_numbers.some((b) =>
        tenantByNumber.has(b.phone_number),
      )
        ? "bound_to_tenant_number"
        : !agentsListed || !numbersListed
          ? "inventory_incomplete"
          : a.bound_numbers.length > 0
            ? "bound_to_number"
            : null;
      unreferenced.push({
        agent_id: a.agent_id,
        agent_name: a.agent_name,
        created_at_approx: a.created_at_approx,
        user_modified_at: a.user_modified_at,
        category: categorize(a.agent_name, knownTenantIds),
        bound_numbers: a.bound_numbers,
        webhook_url: a.webhook_url,
        delete_hold: deleteHold,
      });
    });
    unreferenced.sort((x, y) =>
      (x.created_at_approx ?? x.user_modified_at ?? "").localeCompare(
        y.created_at_approx ?? y.user_modified_at ?? "",
      ),
    );
  } catch (err) {
    if (!(err instanceof BudgetExceeded)) throw err;
    complete = false;
    agentsListed = false;
    errors.push({ step: err.message, status: null, detail: "budget_exhausted" });
  }

  // Findings on resources nobody references are cleanup candidates, not
  // repairs. An owned agent / LLM / flow is repaired by recompiling and
  // republishing the tenant's agent (the compiler writes the configured
  // URLs by construction); an owned number by re-running the attach action,
  // which rewrites `inbound_webhook_url`.
  for (const f of findings) {
    if (f.recommended_action !== "review") continue;
    const tenantOwned = f.owners.some((o) => o.kind === "agent_configs");
    f.recommended_action = tenantOwned
      ? f.resource_type === "phone_number"
        ? "reattach_tenant_number"
        : "republish_tenant_agent"
      : f.owners.length === 0
        ? "owner_cleanup_candidate"
        : "review";
  }

  const severityRank = { high: 0, medium: 1, low: 2 } as const;
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  const orphanLlms = llms.filter((l) => l.used_by_agents.length === 0).map((l) => l.id);
  const orphanFlows = flows.filter((f) => f.used_by_agents.length === 0).map((f) => f.id);
  const allAgentDetailsKnown = agents.every((a) => a.detail_error === null);

  return {
    status: 200,
    body: {
      complete,
      cleanup_list_complete: agentsListed && numbersListed,
      errors,
      expected_urls: deps.expected,
      counts: {
        agents: agents.length,
        phone_numbers: phoneNumbers.length,
        retell_llms: llms.length,
        conversation_flows: flows.length,
        findings: findings.length,
        unreferenced_agents: unreferenced.length,
      },
      findings,
      unreferenced_agents: unreferenced,
      // Only trustworthy when every agent's engine was read.
      orphan_retell_llm_ids: allAgentDetailsKnown ? orphanLlms : [],
      orphan_conversation_flow_ids: allAgentDetailsKnown ? orphanFlows : [],
      agents,
      phone_numbers: phoneNumbers,
      retell_llms: llms,
      conversation_flows: flows,
    },
  };
}

function dedupeRefs(refs: ResourceRef[]): ResourceRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key =
      r.kind === "agent_configs"
        ? `t:${r.tenant_id}`
        : r.kind === "platform_settings"
          ? `s:${r.key}`
          : `e:${r.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function categorize(
  name: string | null,
  knownTenantIds: Set<string>,
): UnreferencedAgent["category"] {
  if (!name) return "unrecognized";
  const tenant = AGENT_NAME_TENANT.exec(name);
  if (tenant?.[1]) {
    return knownTenantIds.has(tenant[1].toLowerCase())
      ? "superseded_tenant_agent"
      : "orphan_tenant_agent";
  }
  if (name.startsWith("heyloo-template-")) return "template_publish_agent";
  if (name === SELF_CALL_CALLER_AGENT_NAME) return "superseded_self_call_caller";
  return "unrecognized";
}
