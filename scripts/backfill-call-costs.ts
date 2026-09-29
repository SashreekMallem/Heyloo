/**
 * COCKPIT-1: backfill per-call provider cost for past calls from Retell's
 * GET /v2/get-call/{call_id} (docs.retellai.com/api-references/get-call —
 * `call_cost.product_costs[]{product,unit_price,cost}` + `combined_cost`, all
 * US cents; unit_price is cents PER SECOND).
 *
 * DRY-RUN BY DEFAULT: lists the candidate calls, fetches each from Retell
 * (read-only GETs) and prints exactly what `--apply` would write — nothing is
 * written to the database. Pass `--apply` to upsert.
 *
 * Candidates: real Retell calls (`retell_call_id ~ '^call_[0-9a-f]+$'`) whose
 * `call_logs.cost_cents IS NULL` (unknown). Synthetic ids (`playground*`,
 * `load_test*` — batch-test/tool-probe shadow rows that never had a Retell
 * call) are excluded and reported. Calls Retell still reports as
 * registered/ongoing are skipped (cost not final).
 *
 * Writes are the SAME idempotent upsert the webhook handler uses
 * (`supabase/functions/_shared/call-cost.ts`): keyed by
 * `(call_id, provider, product, is_transfer_leg_cost)`, source
 * `retell_get_call`; re-running is safe and never double counts.
 *
 *   node --experimental-strip-types scripts/backfill-call-costs.ts            # dry-run
 *   node --experimental-strip-types scripts/backfill-call-costs.ts --apply    # write
 *   ... --limit 50            cap the number of calls processed
 *   ... --include-costed      also re-verify calls that already have a cost
 *                             (reports drift between stored and Retell's cost)
 *
 * Required env vars:
 *   SUPABASE_PROJECT_REF     project ref (e.g. qulcubtwqsqgqpfgvorn)
 *   SUPABASE_ACCESS_TOKEN    Supabase Management API personal access token
 *                            (raw-SQL endpoint, same as republish-fleet.ts)
 *   RETELL_API_KEY           Retell API key (Authorization: Bearer). Without
 *                            it the dry-run still lists the candidates but
 *                            cannot say what Retell would return.
 *   RETELL_API_BASE          optional override (tests only), default https://api.retellai.com
 */

import { pathToFileURL } from "node:url";
import { combinedCostCents, toCostLines } from "../supabase/functions/_shared/call-cost.ts";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const INCLUDE_COSTED = args.includes("--include-costed");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Number.POSITIVE_INFINITY;

function optionalEnv(name: string): string | null {
  return process.env[name] || null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

const PROJECT_REF = requireEnv("SUPABASE_PROJECT_REF");
const ACCESS_TOKEN = requireEnv("SUPABASE_ACCESS_TOKEN");
const RETELL_API_KEY = optionalEnv("RETELL_API_KEY");
const RETELL_API_BASE = optionalEnv("RETELL_API_BASE") ?? "https://api.retellai.com";
const QUERY_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function runQuery<T>(query: string): Promise<T[]> {
  const res = await fetch(QUERY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API query failed (${res.status}): ${text}`);
  return (text ? JSON.parse(text) : []) as T[];
}

/** SQL string literal via dollar quoting — no interpolated value can break out. */
function lit(value: string): string {
  let tag = "q";
  while (value.includes(`$${tag}$`)) tag += Math.random().toString(36).slice(2, 6);
  return `$${tag}$${value}$${tag}$`;
}
function num(value: number | null): string {
  if (value === null) return "null";
  if (!Number.isFinite(value)) throw new Error(`non-finite number ${value}`);
  return String(value);
}

interface Candidate {
  id: string;
  tenant_id: string;
  retell_call_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  cost_cents: number | null;
  is_test_call: boolean;
  channel: string;
}

async function listCandidates(): Promise<{ real: Candidate[]; syntheticSkipped: number }> {
  const costFilter = INCLUDE_COSTED ? "" : "and cost_cents is null";
  const real = await runQuery<Candidate>(`
    select id, tenant_id, retell_call_id, started_at, ended_at, duration_seconds,
           cost_cents, is_test_call, channel
    from public.call_logs
    where retell_call_id ~ '^call_[0-9a-f]+$' ${costFilter}
    order by started_at
  `);
  const synthetic = await runQuery<{ n: number }>(`
    select count(*)::int as n from public.call_logs
    where retell_call_id !~ '^call_[0-9a-f]+$' and cost_cents is null
  `);
  return { real, syntheticSkipped: synthetic[0]?.n ?? 0 };
}

interface RetellCall {
  call_id: string;
  call_status?: string;
  call_cost?: {
    combined_cost?: number;
    product_costs?: {
      product: string;
      cost: number;
      unit_price?: number;
      is_transfer_leg_cost?: boolean;
    }[];
  };
}

/** Runtime boundary check (CLAUDE.md Rule 1.2): reject anything that is not the documented shape. */
export function parseRetellCall(json: unknown): RetellCall {
  if (typeof json !== "object" || json === null) throw new Error("get-call: not an object");
  const o = json as Record<string, unknown>;
  if (typeof o["call_id"] !== "string") throw new Error("get-call: missing call_id");
  const out: RetellCall = { call_id: o["call_id"] };
  if (typeof o["call_status"] === "string") out.call_status = o["call_status"];
  const cc = o["call_cost"];
  if (cc !== undefined && cc !== null) {
    if (typeof cc !== "object") throw new Error("get-call: call_cost not an object");
    const c = cc as Record<string, unknown>;
    const pcs = Array.isArray(c["product_costs"]) ? c["product_costs"] : [];
    out.call_cost = {
      ...(typeof c["combined_cost"] === "number" ? { combined_cost: c["combined_cost"] } : {}),
      product_costs: pcs.flatMap((p) => {
        if (typeof p !== "object" || p === null) return [];
        const r = p as Record<string, unknown>;
        if (typeof r["product"] !== "string" || typeof r["cost"] !== "number") return [];
        return [
          {
            product: r["product"],
            cost: r["cost"],
            ...(typeof r["unit_price"] === "number" ? { unit_price: r["unit_price"] } : {}),
            ...(typeof r["is_transfer_leg_cost"] === "boolean"
              ? { is_transfer_leg_cost: r["is_transfer_leg_cost"] }
              : {}),
          },
        ];
      }),
    };
  }
  return out;
}

async function fetchRetellCall(callId: string): Promise<RetellCall | { error: string }> {
  const res = await fetch(`${RETELL_API_BASE}/v2/get-call/${encodeURIComponent(callId)}`, {
    headers: { Authorization: `Bearer ${RETELL_API_KEY}` },
  });
  if (res.status === 404) return { error: "not_found_at_retell" };
  if (res.status === 429) return { error: "rate_limited" };
  if (!res.ok) return { error: `http_${res.status}` };
  try {
    return parseRetellCall(await res.json());
  } catch (err) {
    return { error: `invalid_shape: ${String(err)}` };
  }
}

export function upsertSql(c: Candidate, call: RetellCall): string {
  const lines = toCostLines(call.call_cost);
  const occurredAt = c.ended_at ?? c.started_at;
  const inserts = lines.map(
    (l) => `
    insert into public.cost_events (
      tenant_id, call_id, provider, product, is_transfer_leg_cost,
      quantity, unit, unit_cost_cents, total_cost_cents, raw, source, occurred_at
    ) values (
      ${lit(c.tenant_id)}::uuid, ${lit(c.id)}::uuid, 'retell', ${lit(l.product)}, ${l.isTransferLeg},
      ${num(l.quantity)}, ${l.unit ? lit(l.unit) : "null"}, ${num(l.unitCostCents)}, ${num(l.totalCostCents)},
      ${lit(JSON.stringify(l.raw))}::jsonb, 'retell_get_call', ${lit(occurredAt)}::timestamptz
    )
    on conflict (call_id, provider, product, is_transfer_leg_cost)
      where call_id is not null and external_ref is null
    do update set quantity = excluded.quantity, unit = excluded.unit,
      unit_cost_cents = excluded.unit_cost_cents, total_cost_cents = excluded.total_cost_cents,
      raw = excluded.raw, source = excluded.source;`,
  );
  const fallback = combinedCostCents(call.call_cost) ?? 0;
  const stamp = `
    update public.call_logs
    set cost_cents = coalesce(
          (select round(sum(total_cost_cents))::int from public.cost_events where call_id = ${lit(c.id)}::uuid),
          ${fallback}),
        cost_source = 'retell_get_call'
    where id = ${lit(c.id)}::uuid;`;
  return `begin;${inserts.join("")}${stamp}commit;`;
}

async function main(): Promise<void> {
  const { real, syntheticSkipped } = await listCandidates();
  const batch = real.slice(0, Number.isFinite(LIMIT) ? LIMIT : real.length);
  console.log(
    `Mode: ${APPLY ? "APPLY (writes to the live database)" : "DRY-RUN (no writes)"} | project ${PROJECT_REF}`,
  );
  console.log(
    `${real.length} real Retell call(s) ${INCLUDE_COSTED ? "(incl. already costed)" : "with unknown cost"}; ` +
      `${syntheticSkipped} synthetic/probe row(s) with no Retell call skipped (playground*, load_test*, ...).`,
  );
  if (!RETELL_API_KEY) {
    console.log(
      "\nRETELL_API_KEY is not set: cannot ask Retell what it would report. Candidates that would be fetched:",
    );
    for (const c of batch) {
      console.log(
        `  ${c.retell_call_id}  ${c.started_at}  ${c.channel.padEnd(9)} dur=${c.duration_seconds ?? "?"}s  stored_cost=${c.cost_cents ?? "NULL"}${c.is_test_call ? "  (test call)" : ""}`,
      );
    }
    return;
  }

  let totalCents = 0;
  let wouldWrite = 0;
  let skipped = 0;
  let drift = 0;
  for (const c of batch) {
    const got = await fetchRetellCall(c.retell_call_id);
    if ("error" in got) {
      skipped++;
      console.log(`SKIP  ${c.retell_call_id}  ${got.error}`);
      continue;
    }
    if (got.call_status === "registered" || got.call_status === "ongoing") {
      skipped++;
      console.log(`SKIP  ${c.retell_call_id}  call_status=${got.call_status} (cost not final)`);
      continue;
    }
    if (!got.call_cost) {
      skipped++;
      console.log(`SKIP  ${c.retell_call_id}  Retell reports no call_cost (stays unknown/NULL)`);
      continue;
    }
    const cents = combinedCostCents(got.call_cost) ?? 0;
    const lines = toCostLines(got.call_cost);
    if (c.cost_cents !== null && c.cost_cents !== cents) drift++;
    totalCents += cents;
    wouldWrite++;
    console.log(
      `${APPLY ? "WRITE" : "WOULD"} ${c.retell_call_id}  cost_cents ${c.cost_cents ?? "NULL"} -> ${cents}  (${lines.length} line item(s): ${lines.map((l) => `${l.product}=${l.totalCostCents.toFixed(4)}`).join(", ") || "none"})  status=${got.call_status ?? "?"}`,
    );
    if (APPLY) await runQuery(upsertSql(c, got));
    await new Promise((r) => setTimeout(r, 150)); // stay well inside Retell's rate limit
  }
  console.log(
    `\n${APPLY ? "Wrote" : "Would write"} ${wouldWrite} call(s), total ${totalCents} cents ($${(totalCents / 100).toFixed(2)}); ` +
      `${skipped} skipped; ${drift} with stored-vs-Retell drift.` +
      (APPLY ? "" : "  Re-run with --apply to write."),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
