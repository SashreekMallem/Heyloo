/**
 * Loads the lazy voice-runtime chunk (`voice-runtime.ts`, a SEPARATE
 * standalone IIFE bundle that carries `retell-client-js-sdk`) only when a
 * visitor actually opens Voice mode — keeping the always-loaded main
 * `widget.js` under the 25KB gz budget (`retell-client-js-sdk` alone is
 * ~200KB unpacked, far over budget on its own). Same-origin script tag
 * (served by `apps/web/src/app/widget-voice.js/route.ts`, our own build
 * output) — never a third-party CDN, matching this package's "no
 * third-party CDN" requirement; it's just split into a second first-party
 * bundle instead of inlined into the first.
 */

export interface VoiceRuntimeHandlers {
  onStarted: () => void;
  onEnded: () => void;
  onError: () => void;
}

export interface VoiceRuntime {
  startCall: (accessToken: string, handlers: VoiceRuntimeHandlers) => void;
  stopCall: () => void;
}

declare global {
  interface Window {
    __heylooVoiceRuntime__?: VoiceRuntime;
    __heylooVoiceRuntimeQueue__?: Array<() => void>;
  }
}

export function loadVoiceRuntime(url: string): Promise<VoiceRuntime> {
  return new Promise((resolve, reject) => {
    if (window.__heylooVoiceRuntime__) {
      resolve(window.__heylooVoiceRuntime__);
      return;
    }
    if (!window.__heylooVoiceRuntimeQueue__) window.__heylooVoiceRuntimeQueue__ = [];
    window.__heylooVoiceRuntimeQueue__.push(() => {
      if (window.__heylooVoiceRuntime__) resolve(window.__heylooVoiceRuntime__);
      else reject(new Error("voice_runtime_unavailable"));
    });

    const existing = document.querySelector("script[data-heyloo-voice-runtime]");
    if (existing) return; // already loading (or loaded, handled above) — queue entry above will fire

    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.setAttribute("data-heyloo-voice-runtime", "1");
    script.onerror = () => {
      const queue = window.__heylooVoiceRuntimeQueue__ || [];
      window.__heylooVoiceRuntimeQueue__ = [];
      for (let i = 0; i < queue.length; i++) queue[i]?.();
    };
    document.head.appendChild(script);
  });
}
