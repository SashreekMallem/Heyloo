/**
 * verify_jwt drift guard (EDGE_AUDIT.md M3, CLAUDE.md's own config.toml
 * comment: "triple-check — the OLD repo died by getting this inverted").
 *
 * `api-checkout`, `api-provision`, `api-adapter-connect`, `admin`, and
 * every other edge function that hand-decodes a bearer JWT's payload
 * itself (no signature check in that code — see each file's own
 * `decodeSub`/`decodeClaims`-shaped helper) are safe ONLY because
 * `supabase/config.toml` sets `verify_jwt = true` for them, so Supabase's
 * platform-level gate rejects an invalid/missing token before that code
 * ever runs. Nothing previously tied that trust assumption to the config
 * value, so a future accidental `verify_jwt = false` flip (a copy-paste
 * across the per-function block, or a `supabase functions deploy` config
 * merge mistake) would silently turn every one of these into a full auth
 * bypass. This script is that tie:
 *
 *   1. Parses `supabase/config.toml`'s `[functions.<slug>]` blocks into a
 *      slug -> verify_jwt map.
 *   2. Scans every `supabase/functions/<slug>/index.ts` for the hand-decode
 *      pattern (`Bearer `, `.split(".")`, and `atob(` all present — the
 *      exact shape every current hand-decoder uses to pull the payload
 *      segment off a bearer token without checking its signature) and
 *      asserts `verify_jwt = true` for every slug that matches.
 *   3. Asserts `verify_jwt = false` for every `webhooks-*`/`job-*`/
 *      `worker-*` slug (these authenticate via their own raw-body HMAC
 *      signature or shared `CRON_INVOKE_SECRET` header, never a user JWT —
 *      BACKEND_SPEC §7's table) — catches the flip in the OTHER direction,
 *      which would make Supabase demand a user JWT these callers (Stripe,
 *      Twilio, pg_cron's pg_net.http_post) never send, breaking the
 *      function outright rather than a silent bypass, but is still exactly
 *      the "got it inverted" class of config regression this guard exists
 *      to catch.
 *   4. Asserts every function directory under `supabase/functions/` (except
 *      `_shared`) has SOME `[functions.<slug>]` entry in config.toml at
 *      all — a newly added function with no entry silently defaults to
 *      Supabase's own platform default, which this guard cannot verify
 *      without an explicit value to check against.
 *
 * Deliberately dependency-free (matches
 * scripts/ci/rls-cross-tenant-probe.ts's own convention) — plain
 * `node:fs`/`node:path`, erasable-TypeScript syntax only, runs via
 * `node --experimental-strip-types scripts/ci/verify-jwt-guard.ts` on
 * Node 22 with no build step.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const FUNCTIONS_DIR = path.join(REPO_ROOT, "supabase", "functions");
const CONFIG_TOML = path.join(REPO_ROOT, "supabase", "config.toml");

const NON_FUNCTION_ENTRIES = new Set([
  "_shared",
  "node_modules",
  "README.md",
  "deno.json",
  "package.json",
  "tsconfig.json",
]);

interface ConfigEntry {
  verifyJwt: boolean;
}

/**
 * Line-based (not single-regex) so interleaved `#` comments between blocks
 * — which this file has plenty of — never confuse section boundaries.
 */
function parseVerifyJwtConfig(tomlText: string): Map<string, ConfigEntry> {
  const map = new Map<string, ConfigEntry>();
  let currentSlug: string | null = null;
  for (const rawLine of tomlText.split("\n")) {
    const line = rawLine.trim();
    const sectionMatch = line.match(/^\[functions\.([a-zA-Z0-9_-]+)\]$/);
    if (sectionMatch) {
      currentSlug = sectionMatch[1] ?? null;
      continue;
    }
    if (line.startsWith("[")) {
      currentSlug = null; // left the [functions.*] block into some other section
      continue;
    }
    if (currentSlug === null) continue;
    const verifyMatch = line.match(/^verify_jwt\s*=\s*(true|false)\b/);
    if (verifyMatch) {
      map.set(currentSlug, { verifyJwt: verifyMatch[1] === "true" });
    }
  }
  return map;
}

function listFunctionSlugs(): string[] {
  return readdirSync(FUNCTIONS_DIR)
    .filter((entry) => !entry.startsWith(".") && !NON_FUNCTION_ENTRIES.has(entry))
    .filter((entry) => statSync(path.join(FUNCTIONS_DIR, entry)).isDirectory());
}

/**
 * Matches BACKEND_SPEC.md's "hand-decoded JWT" shape exactly:
 * `authHeader.startsWith("Bearer ")` → `.split(".")` on the token →
 * `atob(...)` on the payload segment — all three present anywhere in the
 * entrypoint is specific enough not to false-positive on an unrelated
 * base64 use (e.g. `_shared/crypto.ts`'s generic encode/decode helpers,
 * which never appear alongside `"Bearer "` + `split(".")`) while still
 * catching every current and future decoder written the same way.
 */
function handDecodesJwt(entrypointSource: string): boolean {
  return (
    entrypointSource.includes("Bearer ") &&
    (entrypointSource.includes('split(".")') || entrypointSource.includes("split('.')")) &&
    entrypointSource.includes("atob(")
  );
}

function main(): void {
  const configMap = parseVerifyJwtConfig(readFileSync(CONFIG_TOML, "utf-8"));
  const slugs = listFunctionSlugs();
  const failures: string[] = [];

  for (const slug of slugs) {
    const entry = configMap.get(slug);
    if (!entry) {
      failures.push(
        `supabase/functions/${slug} has no [functions.${slug}] entry in supabase/config.toml — ` +
          `every function must explicitly declare verify_jwt, never rely on the platform default.`,
      );
      continue;
    }

    const entrypointPath = path.join(FUNCTIONS_DIR, slug, "index.ts");
    const source = readFileSync(entrypointPath, "utf-8");

    if (handDecodesJwt(source) && !entry.verifyJwt) {
      failures.push(
        `supabase/functions/${slug}/index.ts hand-decodes a bearer JWT's payload without checking ` +
          `its signature, but supabase/config.toml sets verify_jwt = false for it — this would be a ` +
          `full auth bypass (any caller can forge the decoded claims). Set verify_jwt = true.`,
      );
    }

    const isWebhookOrJob = /^(webhooks-|job-|worker-)/.test(slug);
    if (isWebhookOrJob && entry.verifyJwt) {
      failures.push(
        `supabase/functions/${slug} is a webhook/job/worker function (authenticates via its own raw-` +
          `body HMAC signature or shared CRON_INVOKE_SECRET header, never a user JWT) but ` +
          `supabase/config.toml sets verify_jwt = true for it — Supabase's platform gate would then ` +
          `reject every real call from the provider/pg_cron, which never sends a user JWT. Set ` +
          `verify_jwt = false.`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(`\nverify_jwt DRIFT GUARD FAILED — ${failures.length} issue(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(
    `\nverify_jwt drift guard PASSED — ${slugs.length} function(s) checked against supabase/config.toml.`,
  );
}

main();
