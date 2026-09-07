import { describe, expect, it } from "vitest";
import type { SqlClient } from "../_shared/types.js";
import type { RecordingFetchDeps } from "./handler.js";
import { fetchAndStoreRecording } from "./handler.js";

function makeSql(): { sql: SqlClient; calls: { text: string; values: unknown[] }[] } {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join(" "), values });
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

const params = { callId: "cl_1", retellCallId: "call_1", tenantId: "t1" };

describe("fetchAndStoreRecording", () => {
  it("returns not_ready when Retell hasn't produced a recording_url yet", async () => {
    const { sql } = makeSql();
    const deps: RecordingFetchDeps = {
      retellFetch: (() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))) as never,
      retellApiKey: "key",
      uploadToStorage: async () => true,
      fetchRecordingBytes: async () => new ArrayBuffer(8),
    };
    const outcome = await fetchAndStoreRecording(sql, params, deps);
    expect(outcome).toBe("not_ready");
  });

  it("returns call_not_found when Retell's get-call errors", async () => {
    const { sql } = makeSql();
    const deps: RecordingFetchDeps = {
      retellFetch: (() => Promise.resolve(new Response("{}", { status: 404 }))) as never,
      retellApiKey: "key",
      uploadToStorage: async () => true,
      fetchRecordingBytes: async () => new ArrayBuffer(8),
    };
    const outcome = await fetchAndStoreRecording(sql, params, deps);
    expect(outcome).toBe("call_not_found");
  });

  it("stores mono (and stereo, when present) and updates call_logs on success", async () => {
    const { sql, calls } = makeSql();
    const uploaded: string[] = [];
    const deps: RecordingFetchDeps = {
      retellFetch: (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              recording_url: "https://retell/mono.wav",
              recording_multi_channel_url: "https://retell/stereo.wav",
            }),
            { status: 200 },
          ),
        )) as never,
      retellApiKey: "key",
      uploadToStorage: async (path) => {
        uploaded.push(path);
        return true;
      },
      fetchRecordingBytes: async () => new ArrayBuffer(8),
    };
    const outcome = await fetchAndStoreRecording(sql, params, deps);
    expect(outcome).toBe("stored");
    expect(uploaded).toContain("recordings/t1/cl_1.wav");
    expect(uploaded).toContain("recordings/t1/cl_1_stereo.wav");
    const update = calls.find((c) => c.text.includes("update public.call_logs"));
    expect(update?.values).toContain("recordings/t1/cl_1.wav");
  });

  it("returns upload_failed when the mono upload fails", async () => {
    const { sql } = makeSql();
    const deps: RecordingFetchDeps = {
      retellFetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ recording_url: "https://retell/mono.wav" }), {
            status: 200,
          }),
        )) as never,
      retellApiKey: "key",
      uploadToStorage: async () => false,
      fetchRecordingBytes: async () => new ArrayBuffer(8),
    };
    const outcome = await fetchAndStoreRecording(sql, params, deps);
    expect(outcome).toBe("upload_failed");
  });
});
