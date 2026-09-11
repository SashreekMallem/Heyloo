import { fetchVoiceToken, isErrorResponse, mintSession, sendChatMessage } from "./api.js";
import { el } from "./dom.js";
import { ICON_CHAT, ICON_CLOSE, ICON_MIC, ICON_SEND } from "./icons.js";
import { buildStyles } from "./styles.js";
import type { WidgetChatResponse, WidgetConfig, WidgetMode, WidgetPosition } from "./types.js";
import { loadVoiceRuntime, type VoiceRuntime } from "./voice-bridge.js";

/**
 * Builds and wires the whole widget UI inside one shadow root. Deliberately
 * one file, procedural rather than a component framework — this package
 * has none (`package.json`'s own docstring: "framework-free"). No
 * `async`/`await` anywhere (see `api.ts`'s docstring — the ES5 build
 * target can't lower it). Message text is always set via `textContent`
 * (never `innerHTML`) so a hostile/garbled reply can never inject markup
 * into the host page's DOM.
 */

export interface MountOptions {
  widgetPublicKey: string;
  configEndpoint: string;
  /** Preview mode (tenant dashboard's Install page): skips every network
   * call and disables real Voice/Chat submission — see `types.ts`'s
   * `WidgetPreviewConfig` docstring. */
  preview?: {
    business_name: string;
    accent: string | null;
    position: WidgetPosition;
    greeting: string | null;
    modes: WidgetMode[];
  };
}

interface Session {
  token: string | null;
  expiresAtMs: number;
}

const REASON_COPY: Record<string, string> = {
  human_handoff: "A team member is on this conversation now — they'll reply shortly.",
  a2p_not_verified: "Texting isn't fully set up yet — please call or try again soon.",
  opted_out: "This number has opted out of texts.",
  rate_limited: "Please slow down a little — one moment.",
  closed: "This conversation has ended. Send a new message to start another.",
  engine_error: "Sorry, something went wrong on our end. Please try again.",
  verification_pending: "Please check your text messages for a verification code.",
};

function ensureSession(
  session: Session,
  sessionEndpoint: string,
  widgetPublicKey: string,
  now: () => number,
): Promise<string | null> {
  if (session.token && session.expiresAtMs - now() > 5_000) {
    return Promise.resolve(session.token);
  }
  return mintSession(sessionEndpoint, widgetPublicKey).then((result) => {
    if (!result) return null;
    session.token = result.widget_token;
    session.expiresAtMs = new Date(result.expires_at).getTime();
    return session.token;
  });
}

/** Config derived from `opts.preview` when present (no network) — used
 * directly by `renderWithConfig`. Exported so `index.ts`'s real (non-
 * preview) path can build the exact same shape from a fetched
 * `WidgetConfig` without duplicating the preview-vs-real branch. */
export function previewConfig(opts: MountOptions): WidgetConfig | null {
  if (!opts.preview) return null;
  return {
    business_name: opts.preview.business_name,
    accent: opts.preview.accent,
    position: opts.preview.position,
    greeting: opts.preview.greeting,
    modes: opts.preview.modes,
    session_endpoint: "",
    voice_token_endpoint: "",
    chat_endpoint: "",
    voice_runtime_url: "",
  };
}

/** Real entry point: builds the shadow-DOM widget into `doc.body` from an
 * already-resolved config (fetched by `index.ts`, or synthesized by
 * `previewConfig` above). */
export function renderWithConfig(
  opts: MountOptions,
  config: WidgetConfig,
  doc: Document,
  isPreview: boolean,
): void {
  if (config.modes.length === 0) return; // nothing enabled — render nothing, fail closed

  const host = el("div", { id: "heyloo-widget-host" });
  host.style.all = "initial";
  // "open", not "closed": style/DOM isolation from the host page comes from
  // shadow DOM itself either way — "closed" only hides the `.shadowRoot`
  // JS handle, which isn't a real security boundary (the host page never
  // needed access regardless) and would make this widget unreachable to
  // the host site's own accessibility tooling/tests, an explicit tradeoff
  // not worth making for a marginal obscurity gain.
  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = buildStyles(config.accent);
  shadow.appendChild(style);

  const side: "hl-left" | "hl-right" = config.position === "bottom-left" ? "hl-left" : "hl-right";
  const businessName = config.business_name || "Chat with us";

  const launcher = el("button", {
    class: `hl-launcher ${side}`,
    type: "button",
    "aria-haspopup": "dialog",
    "aria-expanded": "false",
    "aria-label": `Open ${businessName} chat`,
  });
  launcher.innerHTML = ICON_CHAT;

  const panel = el("div", {
    class: `hl-panel ${side}`,
    role: "dialog",
    "aria-modal": "false",
    "aria-label": businessName,
    hidden: "",
  });

  const header = el("div", { class: "hl-header" });
  const headerText = el("div", {});
  const title = el("h1", {});
  title.textContent = businessName;
  const sub = el("div", { class: "hl-sub" });
  sub.textContent = isPreview ? "Preview" : "We typically reply in a few minutes";
  headerText.appendChild(title);
  headerText.appendChild(sub);
  const closeBtn = el("button", { class: "hl-close", type: "button", "aria-label": "Close chat" });
  closeBtn.innerHTML = ICON_CLOSE;
  header.appendChild(headerText);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const hasVoice = config.modes.indexOf("voice") !== -1;
  const hasChat = config.modes.indexOf("chat") !== -1;
  const showTabs = hasVoice && hasChat;

  let chatTabBtn: HTMLButtonElement | null = null;
  let voiceTabBtn: HTMLButtonElement | null = null;
  if (showTabs) {
    const tabs = el("div", { class: "hl-tabs", role: "tablist" });
    chatTabBtn = el("button", {
      class: "hl-tab",
      type: "button",
      role: "tab",
      id: "hl-tab-chat",
      "aria-controls": "hl-panel-chat",
    });
    chatTabBtn.textContent = "Chat";
    voiceTabBtn = el("button", {
      class: "hl-tab",
      type: "button",
      role: "tab",
      id: "hl-tab-voice",
      "aria-controls": "hl-panel-voice",
    });
    voiceTabBtn.textContent = "Talk";
    tabs.appendChild(chatTabBtn);
    tabs.appendChild(voiceTabBtn);
    panel.appendChild(tabs);
  }

  const chatBody = hasChat ? buildChatBody(opts.widgetPublicKey, config, isPreview) : null;
  const voiceBody = hasVoice ? buildVoiceBody(opts.widgetPublicKey, config, isPreview) : null;

  if (chatBody) panel.appendChild(chatBody.root);
  if (voiceBody) panel.appendChild(voiceBody.root);

  const footer = el("div", { class: "hl-footer" });
  footer.textContent = isPreview
    ? "Preview only — Voice/Chat aren't live here."
    : "AI assistant · calls & texts may be recorded";
  panel.appendChild(footer);

  function showTab(which: "chat" | "voice") {
    if (chatBody) chatBody.root.hidden = which !== "chat";
    if (voiceBody) voiceBody.root.hidden = which !== "voice";
    if (chatTabBtn) chatTabBtn.setAttribute("aria-selected", String(which === "chat"));
    if (voiceTabBtn) voiceTabBtn.setAttribute("aria-selected", String(which === "voice"));
  }
  if (showTabs) {
    showTab("chat");
    chatTabBtn?.addEventListener("click", () => {
      showTab("chat");
      chatBody?.onShown();
    });
    voiceTabBtn?.addEventListener("click", () => {
      showTab("voice");
    });
  }

  function openPanel() {
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    chatBody?.onShown();
    const focusTarget = (
      showTabs ? (chatTabBtn ?? voiceTabBtn) : (chatBody ?? voiceBody)?.focusEl
    ) as HTMLElement | null;
    if (focusTarget) focusTarget.focus();
  }
  function closePanel() {
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  }

  launcher.addEventListener("click", () => {
    if (panel.hidden) openPanel();
    else closePanel();
  });
  closeBtn.addEventListener("click", closePanel);
  panel.addEventListener("keydown", (evt) => {
    if (evt.key === "Escape") closePanel();
  });

  shadow.appendChild(panel);
  shadow.appendChild(launcher);
  doc.body.appendChild(host);
}

function buildChatBody(
  widgetPublicKey: string,
  config: WidgetConfig,
  isPreview: boolean,
): { root: HTMLDivElement; focusEl: HTMLElement; onShown: () => void } {
  const root = el("div", {
    id: "hl-panel-chat",
    class: "hl-chat-panel",
    role: "tabpanel",
    "aria-labelledby": "hl-tab-chat",
  });
  const list = el("div", {
    class: "hl-body",
    role: "log",
    "aria-live": "polite",
    "aria-label": "Conversation",
  });
  root.appendChild(list);

  const form = el("form", { class: "hl-form" });
  const input = el("input", {
    class: "hl-input",
    type: "text",
    placeholder: "Type a message…",
    "aria-label": "Message",
    autocomplete: "off",
  });
  const sendBtn = el("button", { class: "hl-send", type: "submit", "aria-label": "Send message" });
  sendBtn.innerHTML = ICON_SEND;
  form.appendChild(input);
  form.appendChild(sendBtn);
  root.appendChild(form);

  const session: Session = { token: null, expiresAtMs: 0 };
  let conversationToken: string | null = null;
  let greeted = false;

  function addBubble(text: string, kind: "customer" | "ai" | "system") {
    const bubble = el("div", { class: `hl-msg hl-msg-${kind}` });
    bubble.textContent = text;
    list.appendChild(bubble);
    list.scrollTop = list.scrollHeight;
  }

  function onShown() {
    if (!greeted && config.greeting) {
      addBubble(config.greeting, "ai");
      greeted = true;
    }
  }

  function handleResult(result: WidgetChatResponse | { error: string }) {
    if (isErrorResponse(result)) {
      addBubble("Sorry, that didn't go through. Please try again.", "system");
      return;
    }
    conversationToken = result.conversation_token || conversationToken;
    if (result.sent && result.reply) {
      addBubble(result.reply, "ai");
    } else if (result.reason) {
      addBubble(REASON_COPY[result.reason] ?? "Message received.", "system");
    }
  }

  form.addEventListener("submit", (evt) => {
    evt.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addBubble(text, "customer");
    input.value = "";

    if (isPreview) {
      addBubble(
        "This is a preview — connect the widget on your live site to chat for real.",
        "system",
      );
      return;
    }

    input.disabled = true;
    sendBtn.disabled = true;
    ensureSession(session, config.session_endpoint, widgetPublicKey, () => Date.now())
      .then((token) => {
        if (!token) {
          addBubble("Chat is temporarily unavailable — please try again shortly.", "system");
          return null;
        }
        return sendChatMessage(config.chat_endpoint, token, text, conversationToken);
      })
      .then((result) => {
        if (result) handleResult(result);
      })
      .catch(() => {
        addBubble("Chat is temporarily unavailable — please try again shortly.", "system");
      })
      .then(() => {
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
      });
  });

  return { root, focusEl: input, onShown };
}

function buildVoiceBody(
  widgetPublicKey: string,
  config: WidgetConfig,
  isPreview: boolean,
): { root: HTMLDivElement; focusEl: HTMLElement } {
  const root = el("div", {
    id: "hl-panel-voice",
    class: "hl-voice-panel",
    role: "tabpanel",
    "aria-labelledby": "hl-tab-voice",
  });
  const body = el("div", { class: "hl-voice" });
  const orb = el("div", { class: "hl-voice-orb" });
  orb.innerHTML = ICON_MIC;
  const status = el("div", { class: "hl-voice-status", role: "status" });
  status.textContent = "Tap below to start a call";
  const btn = el("button", { class: "hl-btn hl-btn-primary", type: "button" });
  btn.textContent = "Start call";

  body.appendChild(orb);
  body.appendChild(status);
  body.appendChild(btn);
  root.appendChild(body);

  const session: Session = { token: null, expiresAtMs: 0 };
  let activeRuntime: VoiceRuntime | null = null;

  function setLive(isLive: boolean) {
    orb.className = isLive ? "hl-voice-orb hl-live" : "hl-voice-orb";
    btn.className = isLive ? "hl-btn hl-btn-danger" : "hl-btn hl-btn-primary";
    btn.textContent = isLive ? "End call" : "Start call";
    btn.disabled = false;
    status.textContent = isLive ? "Call in progress…" : "Tap below to start a call";
  }

  function resetToIdle(message: string) {
    activeRuntime = null;
    btn.disabled = false;
    status.textContent = message;
    orb.className = "hl-voice-orb";
    btn.className = "hl-btn hl-btn-primary";
    btn.textContent = "Start call";
  }

  btn.addEventListener("click", () => {
    if (isPreview) {
      status.textContent =
        "This is a preview — connect the widget on your live site to place a call.";
      return;
    }
    if (activeRuntime) {
      status.textContent = "Ending call…";
      activeRuntime.stopCall();
      resetToIdle("Tap below to start a call");
      return;
    }

    btn.disabled = true;
    status.textContent = "Connecting…";
    ensureSession(session, config.session_endpoint, widgetPublicKey, () => Date.now())
      .then((token) => {
        if (!token) throw new Error("no_session");
        return fetchVoiceToken(config.voice_token_endpoint, token);
      })
      .then((result) => {
        if (isErrorResponse(result)) throw new Error(result.error);
        return loadVoiceRuntime(config.voice_runtime_url).then((runtime) => {
          activeRuntime = runtime;
          runtime.startCall(result.access_token, {
            onStarted: () => {
              setLive(true);
            },
            onEnded: () => {
              resetToIdle("Call ended.");
            },
            onError: () => {
              resetToIdle("Call failed — please try again.");
            },
          });
        });
      })
      .catch(() => {
        resetToIdle("Voice call isn't available right now.");
      });
  });

  return { root, focusEl: btn };
}
