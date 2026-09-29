import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentAsksCustomQuestions,
  CURRENT_AGENT_COMPILER_VERSION,
  computePublishStatus,
  languageChangedAt,
  PUBLISH_REASON_TEXT,
  publishStatusQueryKey,
} from "./publish-status";

const CURRENT_AGENT = {
  nodes: [
    { instruction: "Configured call language: {{language}}" },
    { transfer: { number: "{{transfer_number}}" } },
  ],
};

describe("computePublishStatus", () => {
  it("is pending with never_published when there is no published_at", () => {
    expect(
      computePublishStatus({
        publishedAt: null,
        compiledConfig: null,
        transferNumber: null,
        languageConfig: null,
      }),
    ).toEqual({ publishedAt: null, pending: true, reasons: ["never_published"] });
  });

  it("is NOT pending for next-call edits on an up-to-date agent (the old updated_at false positive)", () => {
    const status = computePublishStatus({
      publishedAt: "2026-09-29T00:00:00Z",
      compiledConfig: CURRENT_AGENT,
      transferNumber: "+16105550122",
      languageConfig: { primary: "en", bilingual: false },
    });
    expect(status.pending).toBe(false);
    expect(status.reasons).toEqual([]);
  });

  it("flags a language change made after the last publish", () => {
    const status = computePublishStatus({
      publishedAt: "2026-09-29T00:00:00Z",
      compiledConfig: CURRENT_AGENT,
      transferNumber: null,
      languageConfig: { primary: "es", bilingual: false, changed_at: "2026-09-29T01:00:00Z" },
    });
    expect(status.reasons).toEqual(["language_changed"]);
  });

  it("does not flag a language change that was already published", () => {
    const status = computePublishStatus({
      publishedAt: "2026-09-29T02:00:00Z",
      compiledConfig: CURRENT_AGENT,
      transferNumber: null,
      languageConfig: { primary: "es", changed_at: "2026-09-29T01:00:00Z" },
    });
    expect(status.pending).toBe(false);
  });

  it("flags an agent compiled before the {{language}} token existed", () => {
    const status = computePublishStatus({
      publishedAt: "2026-09-21T07:00:00Z",
      compiledConfig: { prompt: "Transfer to {{transfer_number}}" },
      transferNumber: null,
      languageConfig: { primary: "en" },
    });
    expect(status.reasons).toEqual(["platform_update"]);
  });

  it("flags a set transfer number the published agent can't use", () => {
    const status = computePublishStatus({
      publishedAt: "2026-09-21T07:00:00Z",
      compiledConfig: { prompt: "Configured call language: {{language}}" },
      transferNumber: "+16105550122",
      languageConfig: { primary: "en" },
    });
    expect(status.reasons).toEqual(["platform_update"]);
    // ...but not when no transfer number is set at all.
    expect(
      computePublishStatus({
        publishedAt: "2026-09-21T07:00:00Z",
        compiledConfig: { prompt: "Configured call language: {{language}}" },
        transferNumber: null,
        languageConfig: { primary: "en" },
      }).pending,
    ).toBe(false);
  });

  it("accepts compiled_config as a JSON string too", () => {
    expect(
      computePublishStatus({
        publishedAt: "2026-09-29T00:00:00Z",
        compiledConfig: JSON.stringify(CURRENT_AGENT),
        transferNumber: "+16105550122",
        languageConfig: {},
      }).pending,
    ).toBe(false);
  });
});

describe("computePublishStatus — language revert (SETTINGS-1 review)", () => {
  const compiled = { prompt: "Configured call language: {{language}}" };
  const publishedAt = "2026-09-23T02:28:50Z";

  it("is not pending after switching back to the language the live agent was published with", () => {
    const status = computePublishStatus({
      publishedAt,
      compiledConfig: compiled,
      transferNumber: null,
      languageConfig: {
        primary: "en",
        changed_at: "2026-09-29T02:52:51Z",
        published_primary: "en",
      },
    });
    expect(status.pending).toBe(false);
  });

  it("is pending while the language differs from the published one", () => {
    const status = computePublishStatus({
      publishedAt,
      compiledConfig: compiled,
      transferNumber: null,
      languageConfig: {
        primary: "es",
        changed_at: "2026-09-29T02:52:51Z",
        published_primary: "en",
      },
    });
    expect(status.reasons).toEqual(["language_changed"]);
  });

  it("stays conservative (pending) when the published language wasn't recorded", () => {
    const status = computePublishStatus({
      publishedAt,
      compiledConfig: compiled,
      transferNumber: null,
      languageConfig: { primary: "en", changed_at: "2026-09-29T02:52:51Z" },
    });
    expect(status.reasons).toEqual(["language_changed"]);
  });
});

describe("languageChangedAt", () => {
  it("reads only a parseable timestamp", () => {
    expect(languageChangedAt({ changed_at: "2026-09-29T01:00:00Z" })).toBe("2026-09-29T01:00:00Z");
    expect(languageChangedAt({ changed_at: "yesterday" })).toBeNull();
    expect(languageChangedAt(null)).toBeNull();
  });
});

describe("publishStatusQueryKey", () => {
  it("lives under the agent_configs prefix every agent-settings save invalidates", () => {
    expect(publishStatusQueryKey("t1").slice(0, 3)).toEqual(["tenant", "t1", "agent_configs"]);
  });
});

describe("SETTINGS-2: compiler-version stamp", () => {
  const base = {
    publishedAt: "2026-09-29T00:00:00Z",
    compiledConfig: CURRENT_AGENT,
    transferNumber: null,
    languageConfig: { primary: "en" },
  };

  it("flags an agent that was never stamped (compiled before the stamp existed)", () => {
    const status = computePublishStatus({ ...base, compiledWithVersion: null });
    expect(status.pending).toBe(true);
    expect(status.reasons).toEqual(["compiler_outdated"]);
    expect(PUBLISH_REASON_TEXT.compiler_outdated).toMatch(/published before recent improvements/);
  });

  it("flags an agent compiled with an older compiler version", () => {
    const status = computePublishStatus({
      ...base,
      compiledWithVersion: CURRENT_AGENT_COMPILER_VERSION - 1,
    });
    expect(status.reasons).toEqual(["compiler_outdated"]);
  });

  it("is not pending for an agent compiled with the current version", () => {
    const status = computePublishStatus({
      ...base,
      compiledWithVersion: CURRENT_AGENT_COMPILER_VERSION,
    });
    expect(status).toEqual({ publishedAt: base.publishedAt, pending: false, reasons: [] });
  });

  it("does not flag when the database has no stamp column yet (undefined = unknown)", () => {
    expect(computePublishStatus({ ...base }).pending).toBe(false);
    expect(computePublishStatus({ ...base, compiledWithVersion: undefined }).pending).toBe(false);
  });

  it("says 'published before recent improvements' once, not twice, when the token check already fired", () => {
    const status = computePublishStatus({
      ...base,
      compiledConfig: { prompt: "no tokens" },
      compiledWithVersion: null,
    });
    expect(status.reasons).toEqual(["platform_update"]);
  });

  it("a never-published agent stays never_published only", () => {
    const status = computePublishStatus({
      publishedAt: null,
      compiledConfig: null,
      transferNumber: null,
      languageConfig: null,
      compiledWithVersion: null,
    });
    expect(status.reasons).toEqual(["never_published"]);
  });

  it("INTAKE-Q-1: an agent published on compiler v1 shows 'Changes pending' and does not yet ask custom questions", () => {
    const status = computePublishStatus({ ...base, compiledWithVersion: 1 });
    expect(status.pending).toBe(true);
    expect(status.reasons).toEqual(["compiler_outdated"]);
    expect(PUBLISH_REASON_TEXT.compiler_outdated).toMatch(/custom questions/);
    const publishedAt = base.publishedAt;
    expect(agentAsksCustomQuestions({ publishedAt, compiledWithVersion: 1 })).toBe(false);
    expect(agentAsksCustomQuestions({ publishedAt, compiledWithVersion: null })).toBe(false);
    expect(agentAsksCustomQuestions({ publishedAt: null, compiledWithVersion: 2 })).toBe(false);
    expect(agentAsksCustomQuestions({ publishedAt, compiledWithVersion: 2 })).toBe(true);
    // A database with no stamp column is "unknown", treated like the badge does: not flagged.
    expect(agentAsksCustomQuestions({ publishedAt, compiledWithVersion: undefined })).toBe(true);
  });

  it("the portal's expected version equals the compiler's AGENT_COMPILER_VERSION (drift guard)", () => {
    // Vitest runs with the app (apps/web) as cwd.
    const compilerSource = readFileSync(
      resolve(process.cwd(), "../../supabase/functions/_shared/compiler/template-compiler.ts"),
      "utf8",
    );
    const match = /export const AGENT_COMPILER_VERSION = (\d+);/.exec(compilerSource);
    expect(match, "AGENT_COMPILER_VERSION not found in template-compiler.ts").not.toBeNull();
    expect(Number(match?.[1])).toBe(CURRENT_AGENT_COMPILER_VERSION);
  });
});
