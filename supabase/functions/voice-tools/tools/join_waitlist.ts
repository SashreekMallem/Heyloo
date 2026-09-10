import type { z } from "zod";
import { fnv1aHex, stableStringify } from "../../_shared/idempotency.ts";
import { normalizeE164 } from "../../_shared/phone.ts";
import type { JoinWaitlistArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";

type Args = z.infer<typeof JoinWaitlistArgsSchema>;

export type JoinWaitlistResult =
  | { joined: true; waitlist_entry_id: string }
  | { joined: false; reason: "invalid_phone" | "offering_not_found" };

const UNIQUE_VIOLATION = "23505";

function isPgError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === code;
}

/** `waitlist_entries.idempotency_key` convention (mirrors `bookingIdempotencyKey`/
 * `orderIdempotencyKey` in `_shared/idempotency.ts`): `call_id:fnv1a(stableStringify(window))`
 * — `call_id` already guarantees per-call uniqueness, the hash only needs
 * to distinguish different requested windows within the same call (e.g. a
 * caller who changes their mind about dates mid-call). Defined locally
 * rather than added to `_shared/idempotency.ts` (outside this file's
 * ownership) — reuses that file's already-exported `fnv1aHex`/
 * `stableStringify` primitives. */
function waitlistIdempotencyKey(callId: string, window: { start: string; end: string }): string {
  return `${callId}:${fnv1aHex(stableStringify(window))}`;
}

/**
 * MASTER_SPEC §3.4 `join_waitlist` tool (GAP_REGISTER.md §1.2) — mirrors
 * `create_booking`'s race-proof/idempotent-insert shape: never
 * check-then-insert, a Retell retry of the same tool call with the same
 * args (`tenant_id`, `idempotency_key`) unique-constraint-conflicts and
 * returns the existing row rather than duplicating. `waitlist_entries` has
 * no exclusion constraint (multiple callers can legitimately wait on
 * overlapping windows) — only the idempotency-key uniqueness matters here.
 * The booking-cancellation trigger (`fn_notify_waitlist_on_cancellation`,
 * `20260907131400_functions_triggers.sql`) matches active entries by
 * window overlap and enqueues the "a slot opened — reply YES" SMS; the
 * reply-YES auto-book path (`webhooks-twilio-sms/handler.ts`) is the
 * consumer this tool's insert feeds.
 */
export async function joinWaitlist(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
): Promise<JoinWaitlistResult> {
  const phone = normalizeE164(args.customer.phone);
  if (!phone) return { joined: false, reason: "invalid_phone" };

  if (args.offering_id) {
    const offeringRows = await sql<{ id: string }>`
      select id from public.offerings
      where id = ${args.offering_id} and tenant_id = ${ctx.tenantId} and active
      limit 1
    `;
    if (!offeringRows[0]) return { joined: false, reason: "offering_not_found" };
  }

  const window = { start: args.preferred_window_start, end: args.preferred_window_end };
  const idempotencyKey = waitlistIdempotencyKey(ctx.retellCallId, window);

  const existing = await sql<{ id: string }>`
    select id from public.waitlist_entries
    where tenant_id = ${ctx.tenantId} and idempotency_key = ${idempotencyKey}
    limit 1
  `;
  const prior = existing[0];
  if (prior) return { joined: true, waitlist_entry_id: prior.id };

  const customerRows = await sql<{ id: string }>`
    insert into public.customers (tenant_id, phone_e164, name)
    values (${ctx.tenantId}, ${phone}, ${args.customer.name ?? null})
    on conflict (tenant_id, phone_e164)
    do update set name = coalesce(excluded.name, public.customers.name), last_seen_at = now()
    returning id
  `;
  const customerId = customerRows[0]?.id;
  if (!customerId) return { joined: false, reason: "invalid_phone" };

  try {
    const inserted = await sql<{ id: string }>`
      insert into public.waitlist_entries (
        tenant_id, customer_id, offering_id, resource_type, "window", status, idempotency_key
      ) values (
        ${ctx.tenantId}, ${customerId}, ${args.offering_id ?? null}, ${args.resource_type ?? null},
        tstzrange(${window.start}, ${window.end}), 'active', ${idempotencyKey}
      )
      returning id
    `;
    const row = inserted[0];
    if (!row) return { joined: false, reason: "invalid_phone" };
    return { joined: true, waitlist_entry_id: row.id };
  } catch (err) {
    if (isPgError(err, UNIQUE_VIOLATION)) {
      const raceWinner = await sql<{ id: string }>`
        select id from public.waitlist_entries
        where tenant_id = ${ctx.tenantId} and idempotency_key = ${idempotencyKey}
        limit 1
      `;
      const won = raceWinner[0];
      if (won) return { joined: true, waitlist_entry_id: won.id };
    }
    throw err;
  }
}
