import { describe, expect, it } from "vitest";
import {
  ADAPTER_DISPLAY_NAMES,
  ADAPTER_PROVIDERS,
  COMING_SOON_PROVIDERS,
  connectionDisplayStatus,
  isComingSoon,
  isOAuthProvider,
  isPasteKeyProvider,
  OAUTH_PROVIDERS,
  PASTE_KEY_PROVIDERS,
  popupResultHtml,
  TENANT_DISCONNECT_SENTINEL,
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

describe("coming-soon providers (CONNECT-SAFE-1)", () => {
  it("lists Square, Google Calendar, Shopmonkey and ezyVet as coming soon", () => {
    expect([...COMING_SOON_PROVIDERS].sort()).toEqual(
      ["ezyvet", "google_calendar", "shopmonkey", "square"].sort(),
    );
    for (const provider of ADAPTER_PROVIDERS) expect(isComingSoon(provider)).toBe(true);
  });

  it("is false for an unknown provider (the connect route then answers unknown_provider)", () => {
    expect(isComingSoon("shopify")).toBe(false);
  });
});

describe("connectionDisplayStatus (CONNECT-SAFE-1)", () => {
  it("no row is not connected", () => {
    expect(connectionDisplayStatus(undefined)).toBe("disconnected");
  });

  it("keeps connected and error as written", () => {
    expect(connectionDisplayStatus({ status: "connected", last_error: null })).toBe("connected");
    expect(connectionDisplayStatus({ status: "error", last_error: null })).toBe("error");
  });

  it("disconnected with a failure reason needs a reconnect", () => {
    expect(
      connectionDisplayStatus({
        status: "disconnected",
        last_error: "auth_revoked webhook received",
      }),
    ).toBe("error");
  });

  it("the owner's own disconnect (sentinel reason) or no reason stays disconnected", () => {
    expect(
      connectionDisplayStatus({ status: "disconnected", last_error: TENANT_DISCONNECT_SENTINEL }),
    ).toBe("disconnected");
    expect(connectionDisplayStatus({ status: "disconnected", last_error: null })).toBe(
      "disconnected",
    );
    expect(connectionDisplayStatus({ status: "disconnected", last_error: "" })).toBe(
      "disconnected",
    );
  });

  it("matches the exact sentinel api-adapter-connect writes", () => {
    expect(TENANT_DISCONNECT_SENTINEL).toBe("tenant-initiated disconnect");
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
