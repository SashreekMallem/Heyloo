import { NextResponse } from "next/server";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { requireTenantIdFromSession } from "../session";
import { untypedRpc } from "../shared";

export const runtime = "nodejs";

/**
 * "Sync now" (FRONTEND_SPEC.md §6.8). There is no `public` PostgREST-exposed
 * RPC wrapper around `pgmq.send` today (`supabase/config.toml`'s `[api]
 * schemas` only exposes `public`/`graphql_public` — `pgmq` isn't reachable
 * from this Next.js Route Handler, which only ever talks to Postgres over
 * PostgREST, never a raw connection). Per this task's own instruction
 * ("implement sync-now as an enqueue on the documented queue and request
 * the worker from cluster E"), this calls the real, documented enqueue
 * entry point (`rpc/fn_enqueue_adapter_push`) rather than faking success —
 * that RPC does not exist yet (docs/audit/FIX_REQUESTS.md asks the DB
 * cluster to add it as a thin `security definer` wrapper around
 * `pgmq.send('adapter_push_queue', ...)`, tenant-scoped exactly like every
 * other write path in this schema), so today this genuinely 501s until
 * that migration + `worker-adapter-push`'s `pushToAirtable` land — never a
 * decorative success toast (CLAUDE.md: no fake success paths).
 */
export async function POST() {
  const tenantId = await requireTenantIdFromSession();
  if (!tenantId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const supabase = await createSupabaseServerComponentClient();

  const [{ data: bookings }, { data: orders }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("orders")
      .select("id")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const targets = [
    ...(bookings ?? []).map((b) => ({ entity_type: "booking" as const, entity_id: b.id })),
    ...(orders ?? []).map((o) => ({ entity_type: "order" as const, entity_id: o.id })),
  ];

  let enqueued = 0;
  let rpcMissing = false;
  for (const target of targets) {
    const { error } = await untypedRpc(supabase, "fn_enqueue_adapter_push", {
      p_tenant_id: tenantId,
      p_adapter: "airtable",
      p_entity_type: target.entity_type,
      p_entity_id: target.entity_id,
    });
    if (error) {
      rpcMissing = true;
      break;
    }
    enqueued += 1;
  }

  if (rpcMissing && enqueued === 0) {
    return NextResponse.json(
      { enqueued: 0, pending: targets.length, error: "sync_enqueue_not_yet_available" },
      { status: 501 },
    );
  }
  return NextResponse.json({ enqueued, pending: targets.length });
}
