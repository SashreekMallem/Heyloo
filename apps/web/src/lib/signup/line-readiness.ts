import type { SupabaseClient } from "@supabase/supabase-js";

export interface LineReadiness {
  /** The provisioning saga's `publish_agent` step succeeded (or the tenant's agent has a `published_at`). */
  published: boolean;
  /** The tenant's live (not released) phone number, E.164, or null when none exists yet. */
  number: string | null;
  /** Both: the only state in which the forwarding step may show a number to forward to. */
  ready: boolean;
}

/**
 * Whether a new tenant's line is really live (SIGNUP-BILL-FIX C).
 *
 * `tenants.status` flips to `active` the moment Stripe confirms payment
 * (`checkout.session.completed`), BEFORE the provisioning saga has bought the
 * number or published the agent, so status says nothing about readiness.
 * Gating `/signup/provisioning` -> `/signup/forwarding` on it skipped the
 * timeline and rendered the forwarding codes with no number ("*71" and
 * nothing). Readiness is the saga's own result: `publish_agent` succeeded
 * (which runs after the number is bought) and a live `phone_numbers` row.
 * An agent with `published_at` set also counts, so tenants provisioned
 * outside the saga (admin test tenants) are not stuck on the timeline.
 *
 * RLS-scoped reads as the signed-in tenant member (all three tables have
 * tenant-member select policies).
 */
export async function getLineReadiness(
  supabase: Pick<SupabaseClient, "from">,
  tenantId: string,
): Promise<LineReadiness> {
  const [run, agent, phone] = await Promise.all([
    supabase
      .from("provisioning_runs")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("step", "publish_agent")
      .maybeSingle(),
    supabase.from("agent_configs").select("published_at").eq("tenant_id", tenantId).maybeSingle(),
    supabase
      .from("phone_numbers")
      .select("e164")
      .eq("tenant_id", tenantId)
      .is("released_at", null)
      .limit(1)
      .maybeSingle(),
  ]);

  const published =
    (run.data as { status?: string } | null)?.status === "succeeded" ||
    Boolean((agent.data as { published_at?: string | null } | null)?.published_at);
  const number = (phone.data as { e164?: string } | null)?.e164 ?? null;
  return { published, number, ready: published && number !== null };
}
