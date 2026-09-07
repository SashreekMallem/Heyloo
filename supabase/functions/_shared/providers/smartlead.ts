/**
 * Smartlead cold-email sender via plain `fetch` (API_AND_FLOWS.md A.5,
 * BACKEND_SPEC §1.8). MASTER_SPEC binds Smartlead as the chosen sender
 * (Instantly named only as the documented alternative — CLAUDE.md Rule 4:
 * this file implements Smartlead only; `campaigns.provider` still allows
 * `'instantly'` at the schema level per BACKEND_SPEC, but no Instantly
 * adapter exists in this build).
 *
 * VERIFY (docs/VERIFY.md): `docs.smartlead.ai`/`api.smartlead.ai` were not
 * reachable to WebFetch in this build; every shape below comes from
 * WebSearch-indexed summaries of Smartlead's own current API reference
 * (Rule 1 item 2's documented fallback), not memory. Confirmed
 * high-confidence: base URL `server.smartlead.ai/api/v1`, `api_key` query
 * param auth, `POST /campaigns/create`, `POST /campaigns/{id}/leads`
 * (up to 400 leads/request), `POST /webhook/create`, `PATCH
 * /campaigns/{id}/status` (`START`/`PAUSED`/`STOPPED`). Lower confidence:
 * the exact webhook payload field names for `EMAIL_REPLY` (reply-body key
 * name specifically) and whether Smartlead exposes a distinct
 * spam-complaint event at all — flagged in docs/VERIFY.md, since the
 * CAN-SPAM 0.3% auto-pause rule (BACKEND_SPEC §1.8) needs a real complaint
 * signal to ever fire from a live webhook.
 */

const SMARTLEAD_BASE_URL = "https://server.smartlead.ai/api/v1";

export type SmartleadFetch = (input: string, init?: RequestInit) => Promise<Response>;

function withKey(path: string, apiKey: string): string {
  return `${SMARTLEAD_BASE_URL}${path}?api_key=${encodeURIComponent(apiKey)}`;
}

export interface CreateCampaignResult {
  ok: boolean;
  status: number;
  externalCampaignId?: string;
}

export async function createCampaign(
  fetchImpl: SmartleadFetch,
  apiKey: string,
  params: { name: string },
): Promise<CreateCampaignResult> {
  const res = await fetchImpl(withKey("/campaigns/create", apiKey), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: params.name }),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const body = (await res.json().catch(() => undefined)) as
    | { id?: number | string; campaign?: { id?: number | string } }
    | undefined;
  const id = body?.id ?? body?.campaign?.id;
  return {
    ok: true,
    status: res.status,
    ...(id !== undefined ? { externalCampaignId: String(id) } : {}),
  };
}

export interface SmartleadLeadInput {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  custom_fields?: Record<string, string>;
}

export interface AddLeadsResult {
  ok: boolean;
  status: number;
  addedCount?: number;
  skippedCount?: number;
  body?: unknown;
}

/** Up to 400 leads per call per Smartlead's documented limit — callers are
 * responsible for chunking a larger batch. */
export async function addLeadsToCampaign(
  fetchImpl: SmartleadFetch,
  apiKey: string,
  externalCampaignId: string,
  leads: SmartleadLeadInput[],
): Promise<AddLeadsResult> {
  const res = await fetchImpl(withKey(`/campaigns/${externalCampaignId}/leads`, apiKey), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lead_list: leads }),
  });
  const body = (await res.json().catch(() => undefined)) as
    | { added_count?: number; skipped_count?: number }
    | undefined;
  if (!res.ok) return { ok: false, status: res.status, body };
  return {
    ok: true,
    status: res.status,
    ...(body?.added_count !== undefined ? { addedCount: body.added_count } : {}),
    ...(body?.skipped_count !== undefined ? { skippedCount: body.skipped_count } : {}),
    body,
  };
}

export type SmartleadEventTypeMap = Partial<
  Record<
    | "EMAIL_SENT"
    | "EMAIL_OPEN"
    | "EMAIL_LINK_CLICK"
    | "EMAIL_REPLY"
    | "EMAIL_BOUNCE"
    | "LEAD_UNSUBSCRIBED"
    | "LEAD_CATEGORY_UPDATED",
    boolean
  >
>;

/** `POST /webhook/create` — `association_type: "campaign"` scopes the
 * webhook to one campaign (vs. account-wide); this codebase always scopes
 * per-campaign so a paused/stopped campaign's own webhook config is easy
 * to reason about per-campaign in the admin UI. */
export async function createWebhook(
  fetchImpl: SmartleadFetch,
  apiKey: string,
  params: {
    name: string;
    webhookUrl: string;
    externalCampaignId: string;
    eventTypeMap: SmartleadEventTypeMap;
  },
): Promise<{ ok: boolean; status: number }> {
  const res = await fetchImpl(withKey("/webhook/create", apiKey), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: params.name,
      webhook_url: params.webhookUrl,
      association_type: "campaign",
      email_campaign_id: params.externalCampaignId,
      event_type_map: params.eventTypeMap,
    }),
  });
  return { ok: res.ok, status: res.status };
}

export type SmartleadCampaignStatus = "START" | "PAUSED" | "STOPPED";

/** `PATCH /campaigns/{id}/status` — used by the auto-pause rule
 * (BACKEND_SPEC §1.8, >0.3% complaint rate, CAN-SPAM hard rule) so a local
 * `campaigns.status = 'paused'` write is backed by an actual stop-sending
 * call at the provider, never just a local-DB-only flag. */
export async function updateCampaignStatus(
  fetchImpl: SmartleadFetch,
  apiKey: string,
  externalCampaignId: string,
  status: SmartleadCampaignStatus,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetchImpl(withKey(`/campaigns/${externalCampaignId}/status`, apiKey), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  return { ok: res.ok, status: res.status };
}
