import { describe, expect, it } from "vitest";
import {
  ADAPTER_DISPLAY_NAMES,
  ADAPTER_PROVIDERS,
  isOAuthProvider,
  isPasteKeyProvider,
  OAUTH_PROVIDERS,
  PASTE_KEY_PROVIDERS,
  popupResultHtml,
} from "./shared";

describe("provider classification", () => {
  it("every provider is exactly one of oauth or paste-key, never both", () => {
    for (const provider of ADAPTER_PROVIDERS) {
      expect(isOAuthProvider(provider)).toBe(
        (OAUTH_PROVIDERS as readonly string[]).includes(provider),
      );
      expect(isPasteKeyProvider(provider)).toBe(
        (PASTE_KEY_PROVIDERS as readonly string[]).includes(provider),
      );
      expect(isOAuthProvider(provider) && isPasteKeyProvider(provider)).toBe(false);
    }
  });

  it("rejects an unknown provider string as neither", () => {
    expect(isOAuthProvider("shopify")).toBe(false);
    expect(isPasteKeyProvider("shopify")).toBe(false);
  });

  it("every adapter provider has a display name", () => {
    for (const provider of ADAPTER_PROVIDERS) {
      expect(ADAPTER_DISPLAY_NAMES[provider]).toBeTruthy();
    }
  });
});

describe("popupResultHtml", () => {
  it("embeds the payload and a distinct source tag for the postMessage listener", () => {
    const html = popupResultHtml({ ok: true, provider: "square" });
    expect(html).toContain("heyloo-adapter-oauth");
    expect(html).toContain('"ok":true');
    expect(html).toContain('"provider":"square"');
    expect(html).toContain("window.close()");
  });

  it("escapes '<' so an attacker-influenced error string can't break out of the inline script", () => {
    const html = popupResultHtml({ ok: false, error: "</script><script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
