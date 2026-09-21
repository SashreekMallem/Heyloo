// Deno entrypoint (excluded from ../tsconfig.json). Invoked by the pg_cron
// "Queue worker poll" job (BACKEND_SPEC §8, every minute).
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv, requireServiceRoleKey } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import type { UploadResult } from "./handler.ts";
import { runRecordingFetchWorker } from "./handler.ts";

const logger = createLogger({ fn: "worker-recording-fetch" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SB_SECRET_KEY = requireServiceRoleKey();

async function uploadToStorage(
  path: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<UploadResult> {
  // DASH-2 (docs/BUILD_NOTES.md): `handler.ts` now always passes a
  // bucket-relative `path` (no `recordings/` prefix baked in — that was
  // LOGIN-1's found bug, since the value it also persists to `call_logs.
  // recording_url` must match the real Storage object key exactly). The
  // `.replace` below is kept as defensive tolerance, not load-bearing for
  // new writes: it's what makes this same endpoint correct regardless of
  // which form a future caller passes.
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/recordings/${encodeURI(path.replace(/^recordings\//, ""))}`,
    {
      method: "POST",
      headers: {
        // OPS-8 (docs/BUILD_NOTES.md) root cause #3, confirmed live: the
        // new-format `sb_secret_...` key (CLAUDE.md Rule 1 item 3 — this
        // repo never uses the legacy service_role JWT name) is not a JWT,
        // and Storage's gateway tries to parse `authorization: Bearer`
        // as one regardless — sending the key on `authorization` alone
        // failed every upload with `Invalid Compact JWS` (confirmed via
        // this exact endpoint/bucket before this fix). Per Supabase's own
        // migration guide (supabase.com/docs/guides/getting-started/
        // migrating-to-new-api-keys, fetched 2026-09-21) new-format keys
        // authenticate via the `apikey` header; `authorization` stays
        // required by the gateway's own schema (a bare POST with only
        // `apikey` set was rejected with `headers must have required
        // property 'authorization'`), so both headers carry the SAME key.
        authorization: `Bearer ${SB_SECRET_KEY}`,
        apikey: SB_SECRET_KEY,
        "content-type": contentType,
        "x-upsert": "true",
      },
      body: bytes,
    },
  );
  if (res.ok) return { ok: true };
  const bodyText = await res.text().catch(() => "");
  return { ok: false, detail: `${res.status}:${bodyText.slice(0, 200)}` };
}

async function fetchRecordingBytes(url: string): Promise<ArrayBuffer | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.arrayBuffer();
}

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const deps = {
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    uploadToStorage,
    fetchRecordingBytes,
  };

  const result = await runRecordingFetchWorker(sql, deps, logger);
  return jsonResponse(result);
});
