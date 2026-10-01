import { z } from "zod";
import { env } from "@/lib/env";

/**
 * DELIVERY-1: asks the `api-tenant-business-location` edge function to
 * geocode the signed-in owner's business address right after a save, the
 * same way `api/tenant/agent/publish` reaches `api-tenant-agent-publish`: no
 * body, only the owner's own access token (the edge function takes the
 * tenant from that JWT's app_metadata and re-checks the owner/admin role).
 * The geocoder itself (US Census) is only ever called inside
 * `supabase/functions/**` (CLAUDE.md Rule 2, provider isolation).
 */

export const businessLocationSchema = z.union([
  z.object({
    matched_address: z.string().nullable(),
    lat: z.number(),
    lng: z.number(),
  }),
  z.object({ error: z.enum(["not_found", "lookup_unavailable", "address_incomplete"]) }),
]);
export type BusinessLocation = z.infer<typeof businessLocationSchema>;

const LOCATE_TIMEOUT_MS = 10_000;

/** Never throws: an unreachable function or an unexpected answer is `lookup_unavailable`. */
export async function locateBusiness(accessToken: string): Promise<BusinessLocation> {
  try {
    const res = await fetch(`${env.supabaseFunctionsUrl}/api-tenant-business-location`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(LOCATE_TIMEOUT_MS),
    });
    if (!res.ok) return { error: "lookup_unavailable" };
    const parsed = businessLocationSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : { error: "lookup_unavailable" };
  } catch {
    return { error: "lookup_unavailable" };
  }
}
