import type { RetellFetch } from "../_shared/providers/retell.ts";
import { getCall } from "../_shared/providers/retell.ts";
import type { SqlClient } from "../_shared/types.ts";

/**
 * `recording_fetch_queue` worker (BACKEND_SPEC §9/§7.3). Recordings must be
 * pulled within Retell's <10-minute availability window — the queue's own
 * visibility-timeout/attempt budget (index.ts) is what enforces that, not
 * this function. Storage upload is injected as `uploadToStorage` (a Deno
 * `fetch` call to the Storage REST API) so this file stays portable/
 * testable without a real Supabase project.
 */
export interface RecordingFetchDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  uploadToStorage: (path: string, bytes: ArrayBuffer, contentType: string) => Promise<boolean>;
  fetchRecordingBytes: (url: string) => Promise<ArrayBuffer | null>;
}

export type RecordingFetchOutcome = "stored" | "not_ready" | "call_not_found" | "upload_failed";

export async function fetchAndStoreRecording(
  sql: SqlClient,
  params: { callId: string; retellCallId: string; tenantId: string },
  deps: RecordingFetchDeps,
): Promise<RecordingFetchOutcome> {
  const callResult = await getCall(deps.retellFetch, deps.retellApiKey, params.retellCallId);
  if (!callResult.ok) return "call_not_found";

  const body = callResult.body as { recording_url?: string; recording_multi_channel_url?: string };
  if (!body.recording_url) return "not_ready";

  const monoBytes = await deps.fetchRecordingBytes(body.recording_url);
  if (!monoBytes) return "not_ready";

  const monoPath = `recordings/${params.tenantId}/${params.callId}.wav`;
  const monoOk = await deps.uploadToStorage(monoPath, monoBytes, "audio/wav");
  if (!monoOk) return "upload_failed";

  let stereoPath: string | null = null;
  if (body.recording_multi_channel_url) {
    const stereoBytes = await deps.fetchRecordingBytes(body.recording_multi_channel_url);
    if (stereoBytes) {
      stereoPath = `recordings/${params.tenantId}/${params.callId}_stereo.wav`;
      await deps.uploadToStorage(stereoPath, stereoBytes, "audio/wav");
    }
  }

  await sql`
    update public.call_logs
    set recording_url = ${monoPath}, stereo_recording_url = ${stereoPath}
    where id = ${params.callId}
  `;

  return "stored";
}
