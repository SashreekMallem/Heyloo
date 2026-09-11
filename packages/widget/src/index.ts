import { fetchConfig } from "./api.js";
import { type MountOptions, previewConfig, renderWithConfig } from "./panel.js";
import type { WidgetMode, WidgetPosition } from "./types.js";

/**
 * Main entry point — the single `<script>` tag a tenant pastes into their
 * site (Install page snippet: `<script src=".../widget.js" data-key="...">
 * </script>`). Captures `document.currentScript` SYNCHRONOUSLY at module
 * top level, before any `.then()` callback runs — `document.currentScript`
 * is `null` once execution leaves the initial synchronous script
 * evaluation, a common footgun this deliberately avoids.
 */

const CURRENT_SCRIPT = document.currentScript as HTMLScriptElement | null;

function scriptOrigin(script: HTMLScriptElement | null): string {
  if (!script?.src) return "";
  try {
    return new URL(script.src).origin;
  } catch {
    return "";
  }
}

function parsePreviewAttr(raw: string | null): MountOptions["preview"] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as {
      business_name?: unknown;
      accent?: unknown;
      position?: unknown;
      greeting?: unknown;
      modes?: unknown;
    };
    const modes = (Array.isArray(parsed.modes) ? parsed.modes : ["chat"]).filter(
      (m): m is WidgetMode => m === "voice" || m === "chat",
    );
    return {
      business_name:
        typeof parsed.business_name === "string" ? parsed.business_name : "Chat with us",
      accent: typeof parsed.accent === "string" ? parsed.accent : null,
      position:
        parsed.position === "bottom-left"
          ? ("bottom-left" as WidgetPosition)
          : ("bottom-right" as WidgetPosition),
      greeting: typeof parsed.greeting === "string" ? parsed.greeting : null,
      modes: modes.length > 0 ? modes : ["chat"],
    };
  } catch {
    return undefined;
  }
}

function boot(): void {
  if (document.getElementById("heyloo-widget-host")) return; // already mounted (e.g. this script re-executed)

  const script = CURRENT_SCRIPT;
  const widgetPublicKey = script?.getAttribute("data-key") ?? "";
  const previewAttr = script?.getAttribute("data-preview-config") ?? null;
  const preview = parsePreviewAttr(previewAttr);
  const origin = scriptOrigin(script);
  const configEndpoint = origin ? `${origin}/api/widget/config` : "/api/widget/config";

  const opts: MountOptions = { widgetPublicKey, configEndpoint, preview };

  if (preview) {
    const config = previewConfig(opts);
    if (config) renderWithConfig(opts, config, document, true);
    return;
  }

  if (!widgetPublicKey) return; // nothing to embed without a public key

  fetchConfig(configEndpoint, widgetPublicKey).then((config) => {
    if (!config) return; // widget disabled, key/origin rejected, or network failure — fail silently, never break the host page
    renderWithConfig(opts, config, document, false);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
