import { recordCacEvent, recordPipelineCost } from "../_shared/outreach-cost.ts";
import type { LlmClient } from "../_shared/providers/llm/types.ts";
import type { SmartleadFetch } from "../_shared/providers/smartlead.ts";
import { addLeadsToCampaign } from "../_shared/providers/smartlead.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `job-outreach-personalize-collect` — COLLECT phase (BACKEND_SPEC §1.8,
 * T8 build step 2). Polls every in-flight research batch (`job-outreach-
 * personalize`'s submit phase); once a batch has finished, applies the
 * quality-tier "hook" write for each lead and pushes the result into
 * Smartlead. Provider-neutral since LLM-1: the batch is read through the LLM
 * port from whichever vendor issued its id (a batch submitted before a
 * provider switch is still collected); the hook is written by the current one.
 *
 * The hook-writing step runs as a plain synchronous quality-tier call
 * per lead rather than a second batch round-trip (a deliberate scope
 * decision, docs/BUILD_NOTES.md T8 entry): by the time a research batch
 * has ended, the set of leads needing a hook is already bounded to that
 * one batch (<= the submit job's own per-run cap), and a third
 * submit-then-poll stage would add real operational complexity for a
 * marginal cost saving on an already-cheap, short prompt. This still uses
 * the batch API for the genuinely bulk, independently-parallel half of
 * the pipeline (the research pass, MASTER_PLAN's own "cheap research"
 * step) — "Batches API for bulk" per this build's own instruction, applied
 * where it actually earns its keep.
 *
 * Failure handling matches API_AND_FLOWS.md A.5 exactly: a refused/errored call
 * on the hook (or an errored/expired/canceled batch result for the
 * research step) falls back to a generic, non-personalized opener rather
 * than ever blocking the send.
 */
export interface PersonalizeCollectDeps {
  /** The LLM port for the hook write (quality tier) — the CURRENT provider. */
  llm: LlmClient;
  /** The client that can read the batch being collected (its issuing vendor);
   * defaults to `llm`. */
  batchLlm?: LlmClient;
  smartleadFetch: SmartleadFetch;
  smartleadApiKey: string;
  canSpamFooter: string;
  logger: Logger;
  now?: Date;
}

// MASTER_PLAN's own "~$0.02/lead" figure (SYSTEM_DESIGN §3) — directional,
// re-measure against real token counts once live (API_AND_FLOWS.md A.5).
const ESTIMATED_AI_PERSONALIZATION_CENTS_PER_LEAD = 2;

export async function findInFlightResearchBatchIds(sql: SqlClient): Promise<string[]> {
  const rows = await sql<{ batch_id: string | null }>`
    select distinct enrichment ->> 'research_batch_id' as batch_id
    from public.leads
    where status = 'queued'
      and enrichment ->> 'research_batch_id' is not null
      and enrichment -> 'personalization' is null
  `;
  return rows.map((r) => r.batch_id).filter((id): id is string => Boolean(id));
}

function genericOpener(companyName: string | null): string {
  return companyName
    ? `I came across ${companyName} and thought our AI answering service might be a good fit.`
    : "I thought our AI answering service might be a good fit for your business.";
}

// OUTREACH-2: leads scored by `job-outreach-review-score` at or above this
// confidence get their strongest phone-complaint review snippet worked
// into the opener — a founder's own judgment call on where "the reviews
// make this credible" outweighs "a borderline/noisy score", not a sourced
// benchmark (docs/BUILD_NOTES.md OUTREACH-2 entry; re-tune once real reply
// rates exist to compare against, same caveat this codebase already
// attaches to every other unmeasured outreach-economics constant).
const PHONE_COMPLAINT_SCORE_THRESHOLD = 0.6;

/** `leads.phone_complaint_evidence` is jsonb — postgres.js deserializes it
 * to a plain array already, but this is still untrusted data written by a
 * PAST run of a different job (`job-outreach-review-score`), not
 * guaranteed shape by this file's own types, so it's parsed defensively
 * rather than cast. Returns the first (the classifier is prompted to put
 * its strongest match first) snippet found, or null. */
function strongestComplaintSnippet(evidence: unknown): string | null {
  if (!Array.isArray(evidence)) return null;
  const first = evidence[0];
  if (!first || typeof first !== "object") return null;
  const snippet = (first as Record<string, unknown>)["snippet"];
  return typeof snippet === "string" && snippet.trim() !== "" ? snippet.trim() : null;
}

/** The literal opener pattern this task's own instruction names verbatim
 * ("One of your reviews mentions calling three times and getting
 * voicemail…") — used both as the strong, structured FALLBACK opener when
 * a high-scoring lead's LLM hook call fails (never worse than the
 * generic opener for a lead this promising) and folded into the hook
 * prompt itself as the pattern to follow. */
function complaintOpener(snippet: string): string {
  return `One of your reviews mentions "${snippet}" — that's exactly the kind of missed call our AI answering service exists to catch.`;
}

function splitContactName(contactName: string | null): { first_name?: string; last_name?: string } {
  if (!contactName) return {};
  const parts = contactName.trim().split(/\s+/);
  const first = parts[0];
  const last = parts.slice(1).join(" ");
  return { ...(first ? { first_name: first } : {}), ...(last ? { last_name: last } : {}) };
}

interface LeadForHookRow {
  id: string;
  company_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone_complaint_score: number | null;
  phone_complaint_evidence: unknown;
}

async function pushLeadToSmartlead(
  sql: SqlClient,
  lead: LeadForHookRow,
  openingLine: string,
  deps: PersonalizeCollectDeps,
): Promise<void> {
  if (!lead.email) {
    deps.logger.warn("outreach_personalize_no_email_cannot_send", { lead_id: lead.id });
    return;
  }

  const sendEventRows = await sql<{ id: string; campaign_id: string }>`
    select id, campaign_id from public.send_events
    where lead_id = ${lead.id} and step_index = 0 and status = 'queued'
    limit 1
  `;
  const sendEvent = sendEventRows[0];
  if (!sendEvent) {
    deps.logger.warn("outreach_personalize_no_queued_send_event", { lead_id: lead.id });
    return;
  }

  const campaignRows = await sql<{ external_campaign_id: string | null; provider: string }>`
    select external_campaign_id, provider from public.campaigns where id = ${sendEvent.campaign_id}
  `;
  const campaign = campaignRows[0];
  if (!campaign?.external_campaign_id || campaign.provider !== "smartlead") {
    deps.logger.warn("outreach_personalize_campaign_not_provisioned", {
      lead_id: lead.id,
      campaign_id: sendEvent.campaign_id,
    });
    return;
  }

  const pushResult = await addLeadsToCampaign(
    deps.smartleadFetch,
    deps.smartleadApiKey,
    campaign.external_campaign_id,
    [
      {
        email: lead.email,
        ...splitContactName(lead.contact_name),
        ...(lead.company_name ? { company_name: lead.company_name } : {}),
        custom_fields: { opening_line: openingLine, can_spam_footer: deps.canSpamFooter },
      },
    ],
  );

  if (!pushResult.ok) {
    deps.logger.error("outreach_personalize_smartlead_push_failed", {
      lead_id: lead.id,
      status: pushResult.status,
    });
    return;
  }

  await sql`update public.send_events set status = 'sent', sent_at = now() where id = ${sendEvent.id}`;
  await sql`update public.leads set status = 'sent' where id = ${lead.id}`;
}

export async function collectResearchBatch(
  sql: SqlClient,
  batchId: string,
  deps: PersonalizeCollectDeps,
): Promise<{ collected: number; ended: boolean }> {
  const batch = await (deps.batchLlm ?? deps.llm).batch.get(batchId);
  if (!batch.ok) {
    deps.logger.error("outreach_personalize_collect_batch_status_failed", {
      batch_id: batchId,
      kind: batch.error.kind,
      status: batch.error.status,
    });
    return { collected: 0, ended: false };
  }
  if (batch.status.state === "in_progress") {
    return { collected: 0, ended: false };
  }

  // A batch that failed / expired / was cancelled has no results at all: every
  // lead in it falls back to the generic opener below rather than blocking the
  // send (API_AND_FLOWS.md A.5) — and is collected, not polled forever.
  const researchByLead = new Map<string, string | null>();
  if (batch.status.state === "succeeded") {
    for (const item of batch.status.results) researchByLead.set(item.key, item.text);
  } else {
    deps.logger.warn("outreach_personalize_collect_batch_failed", {
      batch_id: batchId,
      reason: batch.status.reason,
    });
  }

  // Iterate the leads this batch was submitted for (results are keyed by lead
  // id and arrive in any order, so a lead missing from them still gets its
  // generic opener instead of staying queued forever).
  const leadRows = await sql<LeadForHookRow>`
    select id, company_name, contact_name, email, phone_complaint_score, phone_complaint_evidence
    from public.leads
    where enrichment ->> 'research_batch_id' = ${batchId}
      and status = 'queued'
      and enrichment -> 'personalization' is null
  `;
  const now = deps.now ?? new Date();
  let collected = 0;

  for (const lead of leadRows) {
    // OUTREACH-2: a lead `job-outreach-review-score` scored at/above
    // threshold gets its strongest phone-complaint snippet worked into the
    // opener (Flow 5 step 3, task step 3's own literal example phrasing).
    const isHighComplaintScore =
      lead.phone_complaint_score !== null &&
      lead.phone_complaint_score >= PHONE_COMPLAINT_SCORE_THRESHOLD;
    const complaintSnippet = isHighComplaintScore
      ? strongestComplaintSnippet(lead.phone_complaint_evidence)
      : null;

    const research = researchByLead.get(lead.id) ?? null;
    let openingLine: string;
    if (research) {
      const complaintInstruction = complaintSnippet
        ? ` This business has a review complaining about missed/unanswered phone calls — lead with ` +
          `a natural reference to that specific complaint (quote or closely paraphrase: "${complaintSnippet}") ` +
          `rather than the research context below, since it's a stronger, more specific hook.`
        : "";
      const hook = await deps.llm.generateText({
        tier: "quality",
        maxOutputTokens: 120,
        temperature: 0.7,
        timeoutMs: 20_000,
        maxRetries: 1,
        system:
          "Write ONE short, natural cold-email opening line (max 30 words, no greeting, no " +
          "signature) referencing the specific research context given. Return ONLY the line " +
          `itself, nothing else.${complaintInstruction}`,
        input: `Company: ${lead.company_name ?? "their business"}\nResearch: ${research}`,
      });
      openingLine =
        hook.ok && hook.text
          ? hook.text.trim()
          : (complaintSnippet && complaintOpener(complaintSnippet)) ||
            genericOpener(lead.company_name);
    } else if (complaintSnippet) {
      // No research text at all (no website, or the research batch item
      // errored) but a strong complaint signal exists — the complaint
      // snippet IS a personalized hook on its own, stronger than the
      // fully-generic fallback below.
      openingLine = complaintOpener(complaintSnippet);
    } else {
      // Errored/expired/canceled batch result for this lead — fall back
      // rather than block the send (API_AND_FLOWS.md A.5).
      openingLine = genericOpener(lead.company_name);
    }

    await sql`
      update public.leads
      set enrichment = enrichment || jsonb_build_object(
        'personalization', jsonb_build_object('research', ${research}::text, 'opening_line', ${openingLine}::text)
      )
      where id = ${lead.id}
    `;

    await recordPipelineCost(sql, {
      category: "ai_personalization",
      amountCents: ESTIMATED_AI_PERSONALIZATION_CENTS_PER_LEAD,
      occurredAt: now,
    });
    await recordCacEvent(sql, {
      channel: "cold_email",
      leadId: lead.id,
      costCents: ESTIMATED_AI_PERSONALIZATION_CENTS_PER_LEAD,
      occurredAt: now,
    });

    await pushLeadToSmartlead(sql, lead, openingLine, deps);
    collected += 1;
  }

  return { collected, ended: true };
}
