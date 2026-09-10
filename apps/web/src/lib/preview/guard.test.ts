import { afterEach, describe, expect, it } from "vitest";
import { isPreviewModeEnabled } from "./guard";

const ORIGINAL_UI_PREVIEW_MODE = process.env["UI_PREVIEW_MODE"];
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function restoreEnv() {
  if (ORIGINAL_UI_PREVIEW_MODE === undefined) delete process.env["UI_PREVIEW_MODE"];
  else process.env["UI_PREVIEW_MODE"] = ORIGINAL_UI_PREVIEW_MODE;
  // biome-ignore lint/suspicious/noExplicitAny: NODE_ENV is a readonly-typed env var; a test-only restore needs to write it back.
  (process.env as any).NODE_ENV = ORIGINAL_NODE_ENV;
}

describe("isPreviewModeEnabled (UI Preview Mode's runtime guard)", () => {
  afterEach(restoreEnv);

  it("is disabled by default (no env vars set)", () => {
    delete process.env["UI_PREVIEW_MODE"];
    // biome-ignore lint/suspicious/noExplicitAny: see restoreEnv above.
    (process.env as any).NODE_ENV = "development";
    expect(isPreviewModeEnabled()).toBe(false);
  });

  it("is disabled in production even if UI_PREVIEW_MODE=1 — the hard floor", () => {
    process.env["UI_PREVIEW_MODE"] = "1";
    // biome-ignore lint/suspicious/noExplicitAny: see restoreEnv above.
    (process.env as any).NODE_ENV = "production";
    expect(isPreviewModeEnabled()).toBe(false);
  });

  it("is disabled outside production if UI_PREVIEW_MODE is unset", () => {
    delete process.env["UI_PREVIEW_MODE"];
    // biome-ignore lint/suspicious/noExplicitAny: see restoreEnv above.
    (process.env as any).NODE_ENV = "development";
    expect(isPreviewModeEnabled()).toBe(false);
  });

  it("is enabled only when both conditions hold", () => {
    process.env["UI_PREVIEW_MODE"] = "1";
    // biome-ignore lint/suspicious/noExplicitAny: see restoreEnv above.
    (process.env as any).NODE_ENV = "development";
    expect(isPreviewModeEnabled()).toBe(true);
  });

  it('rejects any value other than the literal string "1"', () => {
    process.env["UI_PREVIEW_MODE"] = "true";
    // biome-ignore lint/suspicious/noExplicitAny: see restoreEnv above.
    (process.env as any).NODE_ENV = "development";
    expect(isPreviewModeEnabled()).toBe(false);
  });
});
