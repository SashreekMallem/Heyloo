import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function setCurrentScript(script: HTMLScriptElement | null) {
  Object.defineProperty(document, "currentScript", { value: script, configurable: true });
}

describe("index.ts boot", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setCurrentScript(null);
  });

  it("does nothing when there is no data-key and no preview config", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const script = document.createElement("script");
    script.src = "https://app.example/widget.js";
    setCurrentScript(script);

    await import("../src/index");
    expect(document.getElementById("heyloo-widget-host")).toBeNull();
  });

  it("mounts immediately from data-preview-config without any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const script = document.createElement("script");
    script.src = "https://app.example/widget.js";
    script.setAttribute(
      "data-preview-config",
      JSON.stringify({
        business_name: "Acme",
        accent: "#111111",
        position: "bottom-left",
        greeting: "Hi",
        modes: ["chat"],
      }),
    );
    setCurrentScript(script);

    await import("../src/index");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.getElementById("heyloo-widget-host")).not.toBeNull();
  });

  it("fetches config from the script's own origin using data-key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        business_name: "Acme",
        accent: null,
        position: "bottom-right",
        greeting: null,
        modes: ["chat"],
        session_endpoint: "https://app.example/api/widget/session",
        voice_token_endpoint: "https://app.example/api/widget/voice-token",
        chat_endpoint: "https://fn.example/api-text-chat",
        voice_runtime_url: "https://app.example/widget-voice.js",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const script = document.createElement("script");
    script.src = "https://app.example/widget.js";
    script.setAttribute("data-key", "pk_abc");
    setCurrentScript(script);

    await import("../src/index");
    await vi.waitFor(() => {
      expect(document.getElementById("heyloo-widget-host")).not.toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledWith("https://app.example/api/widget/config?key=pk_abc", {
      method: "GET",
    });
  });
});
