import { normalizeE164 } from "./phone.js";
import type { SqlClient } from "./types.js";

/**
 * Shared dedup checks the outreach engine runs before EVERY lead add
 * (BACKEND_SPEC §1.8: "deduped against suppression_list and existing
 * leads"; task compliance rule: "suppression checked before every lead
 * add") — used both by the initial lead-fetch insert (T8 step 1) and by
 * the admin's add-to-campaign action (re-checked there too, since the
 * suppression list can grow between fetch time and campaign-add time).
 */
export async function isSuppressed(
  sql: SqlClient,
  contact: { email?: string | null; phone?: string | null },
): Promise<boolean> {
  const candidates = [
    contact.email?.trim().toLowerCase(),
    normalizeE164(contact.phone ?? undefined) ?? undefined,
  ].filter((c): c is string => Boolean(c));
  if (candidates.length === 0) return false;

  const rows = await sql<{ id: string }>`
    select id from public.suppression_list where lower(contact) = any(${candidates}) limit 1
  `;
  return rows.length > 0;
}

/** Returns the existing lead's id if one already matches this email or
 * phone, else null — never inserts a second `leads` row for the same
 * contact. */
export async function findExistingLead(
  sql: SqlClient,
  contact: { email?: string | null; phone?: string | null },
): Promise<string | null> {
  const email = contact.email?.trim().toLowerCase();
  const phone = normalizeE164(contact.phone ?? undefined);
  if (!email && !phone) return null;

  const rows = await sql<{ id: string }>`
    select id from public.leads
    where (${email ?? null}::text is not null and lower(email) = ${email ?? null})
       or (${phone ?? null}::text is not null and phone = ${phone ?? null})
    limit 1
  `;
  return rows[0]?.id ?? null;
}
