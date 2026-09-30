import type { SupabaseServerClient } from "@heyloo/supabase-client";

/**
 * Server-side rules for saving `tenants.business_phone` (Agent → Business
 * and the phone setup screen share them). Both run as the signed-in owner,
 * through RLS, scoped to the JWT tenant.
 */

export const HEYLOO_NUMBER_MESSAGE =
  "That's your Heyloo number. Enter the number your customers call today.";

/**
 * The business phone must not be the tenant's own Heyloo number: forwarding
 * it to itself does nothing, the forwarding test refuses it, and as the
 * default transfer destination it would loop a "let me get you a person"
 * straight back to the AI.
 */
export async function checkNotHeylooNumber(
  supabase: SupabaseServerClient,
  tenantId: string,
  businessPhone: string,
): Promise<"ok" | "heyloo_number" | "error"> {
  const { data, error } = await supabase
    .from("phone_numbers")
    .select("e164")
    .eq("tenant_id", tenantId)
    .is("released_at", null);
  if (error) return "error";
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{ e164: string }>;
  return rows.some((row) => row.e164 === businessPhone) ? "heyloo_number" : "ok";
}

function wroteRows(result: { data: unknown; error: unknown }): boolean {
  if (result.error) return false;
  return Array.isArray(result.data) ? result.data.length > 0 : Boolean(result.data);
}

/**
 * Transfer-number sync rule (LAUNCH-forwarding): the agent's transfer
 * destination (`agent_configs.transfer_number`, read live per call — no
 * republish) follows the business phone while it is still the default —
 * i.e. when it is NULL or equals the PREVIOUS business phone. A number the
 * owner deliberately set to something else is never overwritten. Clearing
 * the business phone leaves the transfer number alone (a working
 * destination beats none).
 *
 * Two narrowly filtered updates rather than read-then-write, so a transfer
 * number the owner changes concurrently is never clobbered. Returns whether
 * the transfer number changed.
 */
export async function syncTransferNumberToBusinessPhone(
  supabase: SupabaseServerClient,
  tenantId: string,
  previous: string | null,
  next: string | null,
): Promise<boolean> {
  if (!next || next === previous) return false;
  const filledNull = await supabase
    .from("agent_configs")
    .update({ transfer_number: next })
    .eq("tenant_id", tenantId)
    .is("transfer_number", null)
    .select("id");
  let changed = wroteRows(filledNull);
  if (previous) {
    const followed = await supabase
      .from("agent_configs")
      .update({ transfer_number: next })
      .eq("tenant_id", tenantId)
      .eq("transfer_number", previous)
      .select("id");
    changed = wroteRows(followed) || changed;
  }
  return changed;
}
