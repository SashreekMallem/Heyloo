"use client";

import { useQuery } from "@tanstack/react-query";
import { tenantQueryKey } from "@/lib/hooks/use-tenant-query";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * MSG-3: has carriers approved this business for texting
 * (`tenants.a2p_status = 'verified'`, kept in sync with
 * `messaging_senders` by a trigger)? Anything else, including "not loaded
 * yet" and a failed read, is `false`: the portal never claims a text was sent
 * unless it knows texting is on.
 */
export function useTextingOn(tenantId: string | null): boolean {
  const query = useQuery({
    queryKey: tenantQueryKey(tenantId ?? "none", "texting_on"),
    queryFn: async (): Promise<boolean> => {
      const { data } = await supabaseBrowserClient
        .from("tenants")
        .select("a2p_status")
        .eq("id", tenantId as string)
        .maybeSingle();
      return data?.a2p_status === "verified";
    },
    enabled: !!tenantId,
  });
  return query.data === true;
}
