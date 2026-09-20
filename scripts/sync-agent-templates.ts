/**
 * CALL-3 (docs/BUILD_NOTES.md, follow-up to CALL-1 gap #1): syncs
 * `packages/templates`' registry into the live `agent_templates` table —
 * the proper seed/sync script CALL-1 identified as missing (nothing wires
 * `packages/templates` into a hosted Supabase project; `supabase/seed/
 * seed.sql`'s `[db.seed]` block only ever runs against local dev via
 * `supabase db reset`). CALL-1 shipped `_shared/agent-template-seeds.ts` —
 * a hand-generated, one-time copy of `packages/templates/dist/
 * templates.build.json` — as a lazy per-vertical stopgap
 * (`api-admin-provision-test-tenant/handler.ts#ensureTemplateSeeded`, which
 * already defers to a healthy existing DB row and only falls back to that
 * seed copy when none exists — this script is the real, repeatable
 * replacement for keeping that DB table current, not a replacement for the
 * fallback itself).
 *
 * Reads `packages/templates/dist/templates.build.json` (the same build
 * artifact `_shared/agent-template-seeds.ts` was manually generated from —
 * `pnpm --filter @heyloo/templates build` produces it via
 * `generate-build-artifact.ts`, one `{key, name, version, template}` entry
 * per vertical) and upserts one `agent_templates` row per vertical,
 * idempotent on the table's own `(vertical, version)` unique constraint
 * (`20260907130300_agent_templates.sql`). `voice_id`/`model` are NOT part
 * of the templates registry (RETELL-VERIFIED defaults only, per
 * `_shared/agent-template-seeds.ts`'s header) and an admin can repoint them
 * per template row via `admin`'s template-edit route afterwards — this
 * script only ever sets them on first INSERT and never overwrites them on
 * a later re-sync of the same (vertical, version), so a re-run never
 * clobbers an admin's voice_id/model edit. Likewise `is_active` is only
 * ever set (true) on first INSERT.
 *
 * Talks to the live database via the Supabase Management API's
 * `POST /v1/projects/{ref}/database/query` raw-SQL endpoint — the same
 * endpoint this session's read-only `sbq.sh` helper and prior OPS entries'
 * live-applied migrations both used successfully throughout this build
 * (docs/BUILD_NOTES.md OPS-1..4, CALL-1). VERIFY (docs/VERIFY.md): the
 * official Management API reference page renders client-side and wasn't
 * fetchable in this environment this session — this shape is the
 * empirically-confirmed one, not read from current docs text; re-confirm
 * against api.supabase.com/api/v1 (Scalar reference, "Run a query") if it
 * ever starts rejecting requests.
 *
 * This raw-SQL endpoint takes exactly one `query` string per request — no
 * separate parameter binding — so every value below is inlined as a
 * dollar-quoted SQL literal (`dollarQuote`), never string-concatenated
 * with quote-escaping. This is deliberately NOT the postgres.js
 * `${JSON.stringify(x)}::jsonb` bug this same task (CALL-3) fixed
 * elsewhere: that bug is specific to postgres.js's `prepare: true`
 * learned-parameter-type re-serialization, which does not exist here —
 * there is only one encode step (`JSON.stringify` to produce the SQL
 * literal's text), so `dollarQuote(JSON.stringify(x))::jsonb` is correct.
 *
 * Dependency-free (plain Node `fetch`, no `pg`/`postgres`/`@supabase/*`
 * package), matching `scripts/setup-stripe.ts`'s precedent for this
 * `scripts/` directory. Erasable-TypeScript syntax only, run via:
 *
 *   node --experimental-strip-types scripts/sync-agent-templates.ts
 *
 * Required env vars (see docs/DEPLOY.md for when to run this):
 *   SUPABASE_PROJECT_REF   the project ref (e.g. qulcubtwqsqgqpfgvorn)
 *   SUPABASE_ACCESS_TOKEN  a Supabase Management API personal access token
 *                          (never a project anon/secret key — this is the
 *                          account-level Management API, not PostgREST)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

const SUPABASE_PROJECT_REF = env("SUPABASE_PROJECT_REF");
const SUPABASE_ACCESS_TOKEN = env("SUPABASE_ACCESS_TOKEN");

const MANAGEMENT_API_BASE = "https://api.supabase.com/v1";
const QUERY_URL = `${MANAGEMENT_API_BASE}/projects/${SUPABASE_PROJECT_REF}/database/query`;

// Same RETELL-VERIFIED defaults `_shared/agent-template-seeds.ts` uses
// (docs.retellai.com 2026-09-20: list-voices' own documented example value;
// create-conversation-flow's LLMModel enum) — only ever applied on a
// template's first INSERT for a given (vertical, version), never on a
// re-sync update (see header comment).
const DEFAULT_TEMPLATE_VOICE_ID = "retell-Cimo";
const DEFAULT_TEMPLATE_MODEL = "gpt-4.1-mini";

const BUILD_ARTIFACT_PATH = fileURLToPath(
  new URL("../packages/templates/dist/templates.build.json", import.meta.url),
);

interface CanonicalTemplateEntry {
  key: string;
  name: string;
  version: number;
  template: {
    vertical: string;
    compile_target: string;
    system_prompt: string;
    states: unknown[];
    transitions: unknown[];
    global_intents: unknown[];
    tools: unknown[];
    disclosure_line: string;
  };
}

interface BuildArtifact {
  package_version: string;
  generated_at: string;
  templates: CanonicalTemplateEntry[];
}

function loadBuildArtifact(): BuildArtifact {
  try {
    const raw = readFileSync(BUILD_ARTIFACT_PATH, "utf8");
    return JSON.parse(raw) as BuildArtifact;
  } catch (err) {
    console.error(`Could not read ${BUILD_ARTIFACT_PATH}`);
    console.error(`Run "pnpm --filter @heyloo/templates build" first, then re-run this script.`);
    console.error(err instanceof Error ? err.message : String(err));
    return process.exit(1);
  }
}

/**
 * Wraps `text` in Postgres dollar-quoting (`$tag$...$tag$`) using a tag
 * that provably does not occur in `text`, so arbitrary content (apostrophes,
 * backslashes, embedded quotes — every template's `system_prompt` has all
 * three) never needs escaping and can never break out of the literal.
 */
function dollarQuote(text: string): string {
  let tag = "q";
  while (text.includes(`$${tag}$`)) {
    tag += Math.random().toString(36).slice(2, 6);
  }
  return `$${tag}$${text}$${tag}$`;
}

function jsonbLiteral(value: unknown): string {
  return `${dollarQuote(JSON.stringify(value))}::jsonb`;
}

function textLiteral(value: string): string {
  return dollarQuote(value);
}

async function runQuery(query: string): Promise<unknown> {
  const res = await fetch(QUERY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Management API query failed (status ${res.status}): ${bodyText}`);
  }
  return bodyText ? JSON.parse(bodyText) : [];
}

function buildUpsertQuery(entry: CanonicalTemplateEntry): string {
  const t = entry.template;
  // Deliberately omits voice_id, model, is_active from the UPDATE SET —
  // see header comment: those stay admin-editable and are only ever set
  // on a template's first INSERT for this (vertical, version).
  return `
    insert into public.agent_templates
      (vertical, name, version, compile_target, system_prompt, states, transitions, global_intents, tools, voice_id, model, disclosure_line, is_active)
    values (
      ${textLiteral(t.vertical)}, ${textLiteral(entry.name)}, ${entry.version}, ${textLiteral(t.compile_target)},
      ${textLiteral(t.system_prompt)}, ${jsonbLiteral(t.states)}, ${jsonbLiteral(t.transitions)},
      ${jsonbLiteral(t.global_intents)}, ${jsonbLiteral(t.tools)}, ${textLiteral(DEFAULT_TEMPLATE_VOICE_ID)},
      ${textLiteral(DEFAULT_TEMPLATE_MODEL)}, ${textLiteral(t.disclosure_line)}, true
    )
    on conflict (vertical, version) do update set
      name = excluded.name,
      compile_target = excluded.compile_target,
      system_prompt = excluded.system_prompt,
      states = excluded.states,
      transitions = excluded.transitions,
      global_intents = excluded.global_intents,
      tools = excluded.tools,
      disclosure_line = excluded.disclosure_line
    returning vertical, version, is_active, jsonb_typeof(tools) as tools_typeof;
  `.trim();
}

interface VerticalResult {
  vertical: string;
  version: number;
  ok: boolean;
  detail: string;
}

async function syncOne(entry: CanonicalTemplateEntry): Promise<VerticalResult> {
  const vertical = entry.template.vertical;
  try {
    const rows = (await runQuery(buildUpsertQuery(entry))) as Array<{
      vertical: string;
      version: number;
      is_active: boolean;
      tools_typeof: string;
    }>;
    const row = rows[0];
    if (!row) {
      return { vertical, version: entry.version, ok: false, detail: "upsert returned no row" };
    }
    if (row.tools_typeof !== "array") {
      // Defensive: this script writes jsonb literals via a single
      // JSON.stringify -> ::jsonb cast (never the postgres.js double-encode
      // pattern), so this should be unreachable — but never silently
      // report success against a value that isn't actually the shape it
      // should be.
      return {
        vertical,
        version: entry.version,
        ok: false,
        detail: `tools column is jsonb_typeof='${row.tools_typeof}', expected 'array'`,
      };
    }
    return {
      vertical,
      version: row.version,
      ok: true,
      detail: `is_active=${row.is_active}`,
    };
  } catch (err) {
    return {
      vertical,
      version: entry.version,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const artifact = loadBuildArtifact();
  console.log(
    `Syncing ${artifact.templates.length} template(s) from packages/templates ` +
      `(package_version=${artifact.package_version}, generated_at=${artifact.generated_at}) ` +
      `into agent_templates on project ${SUPABASE_PROJECT_REF}...`,
  );

  const results: VerticalResult[] = [];
  for (const entry of artifact.templates) {
    results.push(await syncOne(entry));
  }

  console.log("");
  console.log("vertical".padEnd(14) + "version".padEnd(9) + "status".padEnd(8) + "detail");
  for (const r of results) {
    console.log(
      r.vertical.padEnd(14) +
        String(r.version).padEnd(9) +
        (r.ok ? "ok" : "FAILED").padEnd(8) +
        r.detail,
    );
  }

  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log(`${results.length - failed.length}/${results.length} verticals synced.`);
  if (failed.length > 0) {
    console.error(
      `${failed.length} vertical(s) failed: ${failed.map((r) => r.vertical).join(", ")}`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
