import { describe, expect, it } from "vitest";
import type { SqlClient } from "../_shared/types.ts";
import type { PurgeCandidateRow } from "./handler.ts";
import { findRecordingsToPurge, purgeOneCallRecording, runRetentionSweep } from "./handler.ts";

function row(overrides: Partial<PurgeCandidateRow> = {}): PurgeCandidateRow {
  return {
    id: "call1",
    tenant_id: "t1",
    recording_url: "recordings/t1/call1.wav",
    stereo_recording_url: "recordings/t1/call1_stereo.wav",
    ...overrides,
  };
}

function makeSql(fixtures: unknown[] = []): { sql: SqlClient; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const sql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push(values);
    return Promise.resolve(fixtures);
  }) as SqlClient;
  return { sql, calls };
}

describe("findRecordingsToPurge", () => {
  it("passes through query results", async () => {
    const { sql } = makeSql([row()]);
    expect(await findRecordingsToPurge(sql, new Date())).toHaveLength(1);
  });
});

describe("purgeOneCallRecording", () => {
  it("strips the recordings/ prefix before calling removeFromStorage, then nulls both columns", async () => {
    const { sql, calls } = makeSql();
    const removedPaths: string[][] = [];
    const ok = await purgeOneCallRecording(sql, row(), {
      removeFromStorage: async (paths) => {
        removedPaths.push(paths);
        return true;
      },
    });
    expect(ok).toBe(true);
    expect(removedPaths[0]).toEqual(["t1/call1.wav", "t1/call1_stereo.wav"]);
    expect(calls[0]).toContain("call1");
  });

  it("does not null the columns when the Storage delete fails", async () => {
    const { sql, calls } = makeSql();
    const ok = await purgeOneCallRecording(sql, row(), {
      removeFromStorage: async () => false,
    });
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("skips the storage call entirely (still nulls) when both recording columns are already null", async () => {
    const { sql, calls } = makeSql();
    let called = false;
    const ok = await purgeOneCallRecording(
      sql,
      row({ recording_url: null, stereo_recording_url: null }),
      {
        removeFromStorage: async () => {
          called = true;
          return true;
        },
      },
    );
    expect(ok).toBe(true);
    expect(called).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe("runRetentionSweep", () => {
  it("purges every candidate and reports counts", async () => {
    let call = 0;
    const sql = ((_strings: TemplateStringsArray, ..._values: unknown[]) => {
      call += 1;
      if (call === 1) return Promise.resolve([row({ id: "c1" }), row({ id: "c2" })]);
      return Promise.resolve([]);
    }) as SqlClient;

    const result = await runRetentionSweep(sql, new Date(), {
      removeFromStorage: async () => true,
    });
    expect(result).toEqual({ purged: 2, failed: 0, total: 2 });
  });

  it("counts storage failures separately from purges", async () => {
    let call = 0;
    const sql = ((_strings: TemplateStringsArray, ..._values: unknown[]) => {
      call += 1;
      if (call === 1) return Promise.resolve([row({ id: "c1" }), row({ id: "c2" })]);
      return Promise.resolve([]);
    }) as SqlClient;

    let n = 0;
    const result = await runRetentionSweep(sql, new Date(), {
      removeFromStorage: async () => {
        n += 1;
        return n !== 1; // first call fails, second succeeds
      },
    });
    expect(result).toEqual({ purged: 1, failed: 1, total: 2 });
  });
});
