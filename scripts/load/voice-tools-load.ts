/**
 * QA-HOT (docs/BUILD_PLAN.md): drives `voice-tools/handler.ts#dispatchTool`
 * — the SAME function `supabase/functions/voice-tools/index.ts` (the real
 * `/voice/tools` Deno entrypoint) calls after signature verification — 25x
 * concurrent per tool, directly in-process against the LIVE database, using
 * the SAME `postgres.js` connection-option builder the real edge function
 * uses (`_shared/db-options.ts#buildConnectionOptions`, portable/Node-safe —
 * only `_shared/deno/db.ts` itself is Deno-only). This is the fallback path
 * CLAUDE.md's hot-path rule + this task's own instructions call for when
 * neither a real signed Retell request nor an internal/test entry point is
 * available to drive `/voice/tools` directly: `voice-tools/index.ts` has NO
 * internal-secret bypass (auth is the Retell HMAC signature only, by
 * design — CLAUDE.md Rule 2, "fail CLOSED"), so this script is the only way
 * to load-test the tool-dispatch code path itself without a real Retell
 * account signing requests.
 *
 * What this DOES measure: `resolveCallContext` + the 3 tools' own SQL query
 * plans/round-trips/index usage — the part of the hot path CLAUDE.md's
 * budget ("no ORM, module-scope client, lean handlers") is actually about,
 * and the part a compiler/template-level QA task can fix at the root.
 *
 * What this does NOT measure: `index.ts`'s own signature-verification work,
 * network/TLS handshake to the deployed Edge Function, or Supabase's
 * function cold-start — those need a real signed request (impossible
 * without the Retell webhook secret from outside Retell) or the deployed
 * function's own `tool_health` telemetry, which is why QA-HOT's PRIMARY
 * latency numbers come from `api-admin-run-agent-tests` batch runs
 * (docs/BUILD_NOTES.md QA-HOT has both sets side by side).
 *
 * Usage:
 *   SUPABASE_DB_URL=postgres://... \
 *     node --experimental-strip-types scripts/load/voice-tools-load.ts \
 *     [--concurrency 25] [--tenant-slug test-riverside-auto]
 *
 * Required env:
 *   SUPABASE_DB_URL   Same Postgres connection string
 *                      `supabase/functions/_shared/deno/db.ts#getSql` reads
 *                      from this exact env var name in the real edge
 *                      function — session-mode pooler connection string.
 *                      Never printed by this script.
 *
 * Picks live test tenants (`tenants.slug like 'test-%'`, one per vertical
 * present) automatically unless `--tenant-slug` narrows to one. Never
 * writes to `test-riverside-auto`'s own `agent_configs`/Retell resources —
 * this script only calls `dispatchTool`, which only reads/writes
 * `availability_slots`/`customers`/`bookings`, exactly what a real call
 * would, all flagged `is_test` by the SAME placeholder-call-id path a
 * Retell batch test uses (`voice-tools/context.ts#isPlaceholderCallId`).
 */
import postgres from "postgres";
// Relative imports keep their `.ts` extension (Deno/Node ESM convention
// this whole `_shared/**` tree already follows) — `--experimental-strip-
// types` only strips types at runtime, it doesn't need path mapping.
// Standalone Node script, same convention as `scripts/e2e/self-call.ts`;
// not part of the `supabase/functions` package's own `tsconfig.json`
// include list, so `pnpm -w typecheck` never typechecks this file (biome
// still lints it — `pnpm -w lint`).
import { buildConnectionOptions } from "../../supabase/functions/_shared/db-options.ts";
import { createLogger } from "../../supabase/functions/_shared/logger.ts";
import type { SqlClient } from "../../supabase/functions/_shared/types.ts";
import { type DispatchDeps, dispatchTool } from "../../supabase/functions/voice-tools/handler.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const SUPABASE_DB_URL = requireEnv("SUPABASE_DB_URL");
const CONCURRENCY = Number(argValue("--concurrency") ?? "25");
const TENANT_SLUG_FILTER = argValue("--tenant-slug");

interface TenantRow {
  id: string;
  slug: string;
  vertical: string;
}

interface ResourceRow {
  id: string;
  type: string;
}

interface Percentiles {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  n: number;
  errors: number;
}

function percentiles(samples: number[]): Percentiles {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  return {
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1] ?? 0,
    n: sorted.length,
    errors: 0,
  };
}

/** Same placeholder-call-id shape `voice-tools/context.ts#isPlaceholderCallId`
 * treats as a batch-test/simulator call — never a real Retell call id
 * shape, so this can never collide with (or be mistaken for) a genuine
 * phone/web call's own `call_logs` row. Unique per invocation so
 * concurrent calls in this run never collide with each other either
 * (`voice-tools/context.ts`'s per-agent/per-tenant placeholder keying is
 * for a shared literal like Retell's own `"playground"` — this script
 * generates a distinct literal per call instead, which that keying scheme
 * passes through unchanged since it only rewrites `agent_id`-bearing
 * calls). */
function syntheticCallId(tool: string, i: number): string {
  return `load_${tool}_${Date.now()}_${i}`;
}

async function timeCall(fn: () => Promise<unknown>): Promise<{ ms: number; ok: boolean }> {
  const start = performance.now();
  try {
    await fn();
    return { ms: performance.now() - start, ok: true };
  } catch (err) {
    console.error("call_failed", err instanceof Error ? err.message : String(err));
    return { ms: performance.now() - start, ok: false };
  }
}

async function main() {
  const sql = postgres(SUPABASE_DB_URL, buildConnectionOptions()) as unknown as SqlClient;
  const logger = createLogger({ fn: "scripts-load-voice-tools", sentryDsn: "" });

  const deps: DispatchDeps = {
    sql,
    logger,
    paymentLink: {
      fetchImpl: fetch,
      stripeSecretKey: "",
      successUrl: "https://heyloo.app/pay/success",
      cancelUrl: "https://heyloo.app/pay/cancelled",
    },
    dentalIntake: { appBaseUrl: "https://heyloo.app" },
  };

  const tenantRows = await sql<TenantRow>`
    select id, slug, vertical from public.tenants
    where slug like 'test-%' and deleted_at is null
    ${TENANT_SLUG_FILTER ? sql`and slug = ${TENANT_SLUG_FILTER}` : sql``}
    order by slug
  `;
  if (tenantRows.length === 0) {
    console.error("No matching test tenants found.");
    process.exit(1);
  }

  console.log(
    `Driving dispatchTool directly against ${tenantRows.length} tenant(s), concurrency=${CONCURRENCY} per tool.`,
  );

  const results: Record<string, number[]> = {
    check_availability: [],
    lookup_customer: [],
    create_booking: [],
  };
  let errors = 0;

  for (const tenant of tenantRows) {
    // check_availability: real read against this tenant's own precomputed
    // `availability_slots` (BACKEND_SPEC §7.2.1) — a wide-open date range so
    // it returns rows for any tenant's business hours regardless of what
    // "now" is when this runs.
    const now = new Date();
    const dateRange = {
      start: now.toISOString(),
      end: new Date(now.getTime() + 14 * 24 * 3600_000).toISOString(),
    };

    const checkAvailCalls = Array.from({ length: CONCURRENCY }, (_, i) =>
      timeCall(() =>
        dispatchTool(
          deps,
          syntheticCallId("check_availability", i),
          "check_availability",
          { date_range: dateRange },
          {
            call_id: syntheticCallId("check_availability", i),
            retell_llm_dynamic_variables: { heyloo_tenant_id: tenant.id },
          },
        ),
      ),
    );

    // lookup_customer: a real seeded phone every test tenant carries
    // (`_shared/test-scenarios.ts#RETURNING_CALLER_PHONE`) — exercises the
    // strict G6 caller-match branch, not just the no-caller-id fallback.
    const returningCallerPhone = "+15552010288";
    const lookupCalls = Array.from({ length: CONCURRENCY }, (_, i) =>
      timeCall(() =>
        dispatchTool(
          deps,
          syntheticCallId("lookup_customer", i),
          "lookup_customer",
          {},
          {
            call_id: syntheticCallId("lookup_customer", i),
            retell_llm_dynamic_variables: {
              heyloo_tenant_id: tenant.id,
              heyloo_test_caller_number: returningCallerPhone,
            },
            from_number: returningCallerPhone,
          },
        ),
      ),
    );

    const [checkAvailSettled, lookupSettled] = await Promise.all([
      Promise.all(checkAvailCalls),
      Promise.all(lookupCalls),
    ]);
    for (const r of checkAvailSettled) {
      if (r.ok) results.check_availability?.push(r.ms);
      else errors++;
    }
    for (const r of lookupSettled) {
      if (r.ok) results.lookup_customer?.push(r.ms);
      else errors++;
    }

    // create_booking: needs a real open resource+slot per concurrent call —
    // fetch this tenant's own active resources once, round-robin them across
    // the concurrent batch (never invents an id; CALL-8's own
    // `resolveBookingResourceId` fallback also covers a resource the caller
    // named that no longer has this exact slot open, which is expected here
    // since CONCURRENCY calls are racing the SAME small slot set on
    // purpose — the point is proving the GIST exclusion constraint stays
    // fast under real contention, not that every call gets a unique slot).
    const resourceRows = await sql<ResourceRow>`
      select id, type from public.resources
      where tenant_id = ${tenant.id} and active limit 5
    `;
    if (resourceRows.length === 0) {
      console.log(`  ${tenant.slug}: no active resources, skipping create_booking`);
      continue;
    }
    const createBookingCalls = Array.from({ length: CONCURRENCY }, (_, i) => {
      const resource = resourceRows[i % resourceRows.length] as ResourceRow;
      const start = new Date(now.getTime() + (i + 1) * 3600_000);
      const end = new Date(start.getTime() + 3600_000);
      const phone = `+1555${String(9000000 + i).padStart(7, "0")}`;
      return timeCall(() =>
        dispatchTool(
          deps,
          syntheticCallId("create_booking", i),
          "create_booking",
          {
            resource_id: resource.id,
            start: start.toISOString(),
            end: end.toISOString(),
            customer: { name: `Load Test ${i}`, phone },
          },
          {
            call_id: syntheticCallId("create_booking", i),
            retell_llm_dynamic_variables: { heyloo_tenant_id: tenant.id },
          },
        ),
      );
    });
    const createBookingSettled = await Promise.all(createBookingCalls);
    for (const r of createBookingSettled) {
      if (r.ok) results.create_booking?.push(r.ms);
      else errors++;
    }

    console.log(`  ${tenant.slug} (${tenant.vertical}) done`);
  }

  console.log("\n--- voice-tools dispatchTool latency (ms), in-process, live DB ---");
  console.log("tool".padEnd(20), "n", "p50", "p95", "p99", "max");
  for (const [tool, samples] of Object.entries(results)) {
    if (samples.length === 0) {
      console.log(tool.padEnd(20), "0 samples");
      continue;
    }
    const p = percentiles(samples);
    console.log(
      tool.padEnd(20),
      String(p.n).padEnd(4),
      p.p50.toFixed(1).padEnd(8),
      p.p95.toFixed(1).padEnd(8),
      p.p99.toFixed(1).padEnd(8),
      p.max.toFixed(1),
    );
  }
  if (errors > 0) console.log(`\n${errors} call(s) failed — see call_failed lines above.`);

  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
