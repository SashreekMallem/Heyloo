/**
 * SEPARATE entry point (own IIFE bundle, `tsup.config.ts`'s `voice-runtime`
 * entry) — bundles `retell-client-js-sdk` directly (a real npm dependency,
 * never a third-party CDN script tag — the "no third-party CDN"
 * requirement is about NOT `<script src="https://some-cdn/...">`-ing a
 * vendor's hosted copy; bundling the same audio SDK the dashboard's own
 * "test your agent" web-call feature already uses
 * (`apps/web/src/components/tenant/test-agent-client.tsx`) into OUR OWN
 * build output, served from our own origin, is the established in-repo
 * pattern this follows). Loaded on demand by `voice-bridge.ts`'s
 * `loadVoiceRuntime()` only once a visitor opens Voice mode, so the
 * always-loaded main `widget.js` never pays this SDK's ~200KB unpacked
 * weight.
 */
import { RetellWebClient } from "retell-client-js-sdk";
import type { VoiceRuntime, VoiceRuntimeHandlers } from "./voice-bridge.js";

declare global {
  interface Window {
    __heylooVoiceRuntime__?: VoiceRuntime;
    __heylooVoiceRuntimeQueue__?: Array<() => void>;
  }
}

(function boot() {
  let client: RetellWebClient | null = null;

  const runtime: VoiceRuntime = {
    startCall: (accessToken: string, handlers: VoiceRuntimeHandlers) => {
      client = new RetellWebClient();
      client.on("call_started", handlers.onStarted);
      client.on("call_ended", handlers.onEnded);
      client.on("error", handlers.onError);
      client.startCall({ accessToken: accessToken }).catch(() => {
        handlers.onError();
      });
    },
    stopCall: () => {
      if (client) client.stopCall();
      client = null;
    },
  };

  window.__heylooVoiceRuntime__ = runtime;
  const queue = window.__heylooVoiceRuntimeQueue__ || [];
  window.__heylooVoiceRuntimeQueue__ = [];
  for (let i = 0; i < queue.length; i++) queue[i]?.();
})();
