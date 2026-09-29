import { NextResponse } from "next/server";
import {
  mergeOverrides,
  parseBody,
  requireTenantWriter,
  updateResult,
} from "@/lib/settings/route-auth";
import { instructionsRequestSchema } from "@/lib/settings/schemas";

export const runtime = "nodejs";

/**
 * `POST /api/tenant/agent/instructions` (SETTINGS-1): Agent → AI
 * Instructions. Server-side validation for what used to be a direct,
 * client-validated-only browser write:
 *
 * - `transfer_number` normalized to E.164 (friendly input accepted), and a
 *   blank value now CLEARS it (`null`) — before, an emptied field failed
 *   the E.164 regex so a saved number could never be removed.
 * - The `dynamic_variable_overrides` keys this tab owns are merged, never
 *   replacing sibling keys other tabs own; a blank field deletes its key.
 * - `call_routing` (when to transfer, after-hours number) is new storage;
 *   no call-time reader exists yet (docs/BUILD_NOTES.md SETTINGS-1), and
 *   the tab labels it that way.
 */
export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, instructionsRequestSchema);
  if (!body.ok) return body.response;
  const input = body.data;

  const { data: existing, error: readError } = await auth.supabase
    .from("agent_configs")
    .select("dynamic_variable_overrides")
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: "read_failed" }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const callRouting =
    input.call_routing === undefined
      ? undefined
      : input.call_routing === null
        ? null
        : {
            transfer_window: input.call_routing.transfer_window,
            transfer_urgent: input.call_routing.transfer_urgent,
            ...(input.call_routing.after_hours_phone
              ? { after_hours_phone: input.call_routing.after_hours_phone }
              : {}),
          };

  const overrides = mergeOverrides(existing.dynamic_variable_overrides, {
    voicemail_message: input.voicemail_message,
    manager_name: input.manager_name,
    manager_phone: input.manager_phone,
    parking_info: input.parking_info,
    accessibility_notes: input.accessibility_notes,
    accepted_payment_types: input.accepted_payment_types,
    call_routing: callRouting,
  });

  const update: {
    dynamic_variable_overrides: Record<string, unknown>;
    special_instructions?: string | null;
    transfer_number?: string | null;
  } = { dynamic_variable_overrides: overrides };
  if (input.special_instructions !== undefined) {
    update.special_instructions = input.special_instructions;
  }
  if (input.transfer_number !== undefined) update.transfer_number = input.transfer_number;

  const result = await auth.supabase
    .from("agent_configs")
    .update(update)
    .eq("tenant_id", auth.tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;

  return NextResponse.json({ ok: true, transfer_number: input.transfer_number ?? null });
}
