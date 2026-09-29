import "server-only";

import { randomInt } from "node:crypto";
import type { SupabaseServiceRoleClient } from "@heyloo/supabase-client";

/** Unambiguous alphabet (no 0/O/1/I): codes get read aloud and retyped. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const MAX_INSERT_ATTEMPTS = 5;
/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/**
 * A referral code from the CSPRNG (`crypto.randomInt`, uniform: no modulo
 * bias). Codes are the only thing standing between a stranger and someone
 * else's commission stream, so they must not be predictable
 * (`Math.random` was) — 32^8 is about 1.1e12 possibilities.
 */
export function generateReferralCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Insert a `referral_links` row for `partnerId` with a fresh code, retrying
 * with a new code when the unique constraint (`referral_links_code_unique`)
 * rejects a collision. `referral_links` has no client insert policy, so
 * `service` must be the service-role client. Returns the created code, or
 * `null` if every attempt failed (callers re-select in case a concurrent
 * request created the partner's link first).
 */
export async function insertReferralLink(
  service: SupabaseServiceRoleClient,
  partnerId: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
    const { data, error } = await service
      .from("referral_links")
      .insert({ referral_partner_id: partnerId, code: generateReferralCode() })
      .select("code")
      .single();
    if (data?.code) return data.code;
    if (error?.code !== UNIQUE_VIOLATION) return null;
  }
  return null;
}
