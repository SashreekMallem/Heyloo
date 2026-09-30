"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { claimsFromSupabaseClient } from "./claims";
import { performSignOut } from "./sign-out";

export interface AccountIdentity {
  email: string | null;
  /** Human label for the signed-in role ("Owner", "Platform admin", "Referral partner"), or null while unknown. */
  roleLabel: string | null;
}

const ROLE_LABELS = { owner: "Owner", admin: "Admin", member: "Member" } as const;

/**
 * Who is signed in, for the account menu (QA-1 AUTH-02/MAP-04). Display
 * only — reads the browser session's email and the JWT's own claims (the
 * Custom Access Token Hook output, see `claims.ts`), never used to
 * authorize anything. `roleLabelOverride` lets a shell that already knows
 * its audience ("Platform admin") skip the claims read.
 */
export function useAccountIdentity(roleLabelOverride?: string): AccountIdentity {
  const [identity, setIdentity] = useState<AccountIdentity>({
    email: null,
    roleLabel: roleLabelOverride ?? null,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [{ data }, claims] = await Promise.all([
        supabaseBrowserClient.auth.getSession(),
        claimsFromSupabaseClient(supabaseBrowserClient),
      ]);
      if (cancelled) return;
      const derived = claims.platform_admin
        ? "Platform admin"
        : claims.role
          ? ROLE_LABELS[claims.role]
          : claims.referral_partner_id
            ? "Referral partner"
            : null;
      setIdentity({
        email: data.session?.user.email ?? null,
        roleLabel: roleLabelOverride ?? derived,
      });
    })().catch(() => {
      // Display-only: an unreadable session just leaves the menu without an email line.
    });
    return () => {
      cancelled = true;
    };
  }, [roleLabelOverride]);

  return identity;
}

/**
 * Ends the session: `auth.signOut()` clears the cookie session, then the
 * app goes to `/login`. A failed sign-out (offline) is surfaced rather than
 * navigating away while still signed in.
 */
export function useSignOut(): () => Promise<void> {
  const router = useRouter();
  return useCallback(async () => {
    if (!(await performSignOut())) {
      toast.error("Couldn't log out — please try again.");
      return;
    }
    router.push("/login");
    router.refresh();
  }, [router]);
}
