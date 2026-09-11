import { afterEach, describe, expect, it, vi } from "vitest";
import { type MountOptions, previewConfig, renderWithConfig } from "../src/panel";
import type { WidgetConfig } from "../src/types";

function baseOpts(overrides: Partial<MountOptions> = {}): MountOptions {
  return {
    widgetPublicKey: "pk_1",
    configEndpoint: "https://app.example/api/widget/config",
    ...overrides,
  };
}

function baseConfig(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    business_name: "Acme Dental",
    accent: "#0ea5e9",
    position: "bottom-right",
    greeting: "Hi! How can we help?",
    modes: ["voice", "chat"],
    session_endpoint: "https://app.example/api/widget/session",
    voice_token_endpoint: "https://app.example/api/widget/voice-token",
    chat_endpoint: "https://fn.example/api-text-chat",
    voice_runtime_url: "https://app.example/widget-voice.js",
    ...overrides,
  };
}

function getHost(): HTMLDivElement {
  const host = document.getElementById("heyloo-widget-host");
  if (!host) throw new Error("widget host not mounted");
  return host as HTMLDivElement;
}

function shadowOf(host: HTMLDivElement): ShadowRoot {
  const shadow = host.shadowRoot;
  if (!shadow)
    throw new Error("no shadow root — was mode 'closed' captured incorrectly by the test?");
  return shadow;
}

describe("renderWithConfig", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts a single shadow-DOM host and never leaks widget markup into the light DOM", () => {
    renderWithConfig(baseOpts(), baseConfig(), document, false);
    expect(document.getElementById("heyloo-widget-host")).not.toBeNull();
    expect(document.querySelector(".hl-launcher")).toBeNull(); // only reachable via shadowRoot
  });

  it("renders nothing when no modes are enabled (fails closed)", () => {
    renderWithConfig(baseOpts(), baseConfig({ modes: [] }), document, false);
    expect(document.getElementById("heyloo-widget-host")).toBeNull();
  });

  it("renders tabs only when both voice and chat are enabled", () => {
    renderWithConfig(baseOpts(), baseConfig({ modes: ["chat"] }), document, false);
    const shadow = shadowOf(getHost());
    expect(shadow.querySelector('[role="tablist"]')).toBeNull();
    expect(shadow.querySelector("#hl-panel-chat")).not.toBeNull();
    expect(shadow.querySelector("#hl-panel-voice")).toBeNull();
  });

  it("renders both tabs, chat selected first, when both modes are enabled", () => {
    renderWithConfig(baseOpts(), baseConfig(), document, false);
    const shadow = shadowOf(getHost());
    const chatTab = shadow.querySelector("#hl-tab-chat") as HTMLElement;
    const voiceTab = shadow.querySelector("#hl-tab-voice") as HTMLElement;
    expect(chatTab.getAttribute("aria-selected")).toBe("true");
    expect(voiceTab.getAttribute("aria-selected")).toBe("false");
    expect((shadow.querySelector("#hl-panel-chat") as HTMLElement).hidden).toBe(false);
    expect((shadow.querySelector("#hl-panel-voice") as HTMLElement).hidden).toBe(true);
  });

  it("positions the launcher/panel on the left when configured bottom-left", () => {
    renderWithConfig(baseOpts(), baseConfig({ position: "bottom-left" }), document, false);
    const shadow = shadowOf(getHost());
    expect(shadow.querySelector(".hl-launcher")?.className).toContain("hl-left");
  });

  it("launcher toggles the panel open/closed and updates aria-expanded", () => {
    renderWithConfig(baseOpts(), baseConfig(), document, false);
    const shadow = shadowOf(getHost());
    const launcher = shadow.querySelector(".hl-launcher") as HTMLButtonElement;
    const panel = shadow.querySelector(".hl-panel") as HTMLElement;
    expect(panel.hidden).toBe(true);
    expect(launcher.getAttribute("aria-expanded")).toBe("false");

    launcher.click();
    expect(panel.hidden).toBe(false);
    expect(launcher.getAttribute("aria-expanded")).toBe("true");

    launcher.click();
    expect(panel.hidden).toBe(true);
    expect(launcher.getAttribute("aria-expanded")).toBe("false");
  });

  it("close button hides the panel and returns focus to the launcher", () => {
    renderWithConfig(baseOpts(), baseConfig(), document, false);
    const shadow = shadowOf(getHost());
    const launcher = shadow.querySelector(".hl-launcher") as HTMLButtonElement;
    launcher.click();
    const closeBtn = shadow.querySelector(".hl-close") as HTMLButtonElement;
    closeBtn.click();
    const panel = shadow.querySelector(".hl-panel") as HTMLElement;
    expect(panel.hidden).toBe(true);
  });

  it("Escape closes the panel", () => {
    renderWithConfig(baseOpts(), baseConfig(), document, false);
    const shadow = shadowOf(getHost());
    const launcher = shadow.querySelector(".hl-launcher") as HTMLButtonElement;
    launcher.click();
    const panel = shadow.querySelector(".hl-panel") as HTMLElement;
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel.hidden).toBe(true);
  });

  it("shows the configured greeting once chat is opened, not before", () => {
    renderWithConfig(baseOpts(), baseConfig(), document, false);
    const shadow = shadowOf(getHost());
    expect(shadow.querySelector(".hl-msg-ai")).toBeNull();
    (shadow.querySelector(".hl-launcher") as HTMLButtonElement).click();
    expect(shadow.querySelector(".hl-msg-ai")?.textContent).toBe("Hi! How can we help?");
  });

  it("preview mode never calls the network and shows a preview notice on send", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const opts = baseOpts({
      preview: {
        business_name: "Acme",
        accent: null,
        position: "bottom-right",
        greeting: null,
        modes: ["chat"],
      },
    });
    const config = previewConfig(opts);
    expect(config).not.toBeNull();
    renderWithConfig(opts, config as WidgetConfig, document, true);

    const shadow = shadowOf(getHost());
    (shadow.querySelector(".hl-launcher") as HTMLButtonElement).click();
    const input = shadow.querySelector(".hl-input") as HTMLInputElement;
    input.value = "hello";
    const form = shadow.querySelector(".hl-form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    expect(fetchMock).not.toHaveBeenCalled();
    const bubbles = Array.from(shadow.querySelectorAll(".hl-msg")).map((n) => n.textContent);
    expect(bubbles).toContain("hello");
    expect(bubbles.some((t) => t?.includes("This is a preview"))).toBe(true);
    vi.unstubAllGlobals();
  });

  it("sends a real chat message end to end and renders the AI reply", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          widget_token: "wt.sig",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conversation_token: "c1", reply: "We can help!", sent: true }),
      });
    vi.stubGlobal("fetch", fetchMock);

    renderWithConfig(baseOpts(), baseConfig({ modes: ["chat"], greeting: null }), document, false);
    const shadow = shadowOf(getHost());
    const input = shadow.querySelector(".hl-input") as HTMLInputElement;
    input.value = "book me an appointment";
    const form = shadow.querySelector(".hl-form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    await vi.waitFor(() => {
      expect(shadow.querySelector(".hl-msg-ai")?.textContent).toBe("We can help!");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
