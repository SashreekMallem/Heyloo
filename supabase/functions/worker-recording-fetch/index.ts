// Deno entrypoint (excluded from ../tsconfig.json). Invoked by the pg_cron
// "Queue worker poll" job (BACKEND_SPEC §8, every minute).
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv, requireServiceRoleKey } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
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
): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/recordings/${encodeURI(path.replace(/^recordings\//, ""))}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${SB_SECRET_KEY}`,
        "content-type": contentType,
        "x-upsert": "true",
      },
      body: bytes,
    },
  );
  return res.ok;
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
