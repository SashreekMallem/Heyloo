import { describe, expect, it } from "vitest";
import { computePublishStatus, languageChangedAt, publishStatusQueryKey } from "./publish-status";

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
