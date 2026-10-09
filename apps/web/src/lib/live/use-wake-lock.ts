"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Screen Wake Lock for the live screen (LIVE-1;
 * https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).
 * Only a visible document can hold the lock and the browser drops it when
 * the tab is hidden, so it is re-requested on every `visibilitychange` back
 * to visible. Unsupported or refused simply reports the state; the screen
 * keeps working (the owner sets auto-lock to "Never" instead).
 */
export type WakeLockState = "off" | "on" | "unsupported" | "unavailable";

export function useWakeLock(enabled: boolean): { state: WakeLockState; request: () => void } {
  const [state, setState] = useState<WakeLockState>("off");
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  /** True between a `request()` and the effect cleanup; a late grant after cleanup is released. */
  const wantedRef = useRef(false);

  const request = useCallback(() => {
    wantedRef.current = true;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      setState("unsupported");
      return;
    }
    if (document.visibilityState !== "visible") return;
    if (sentinelRef.current && !sentinelRef.current.released) return;
    navigator.wakeLock
      .request("screen")
      .then((sentinel) => {
        if (!wantedRef.current) {
          void sentinel.release().catch(() => undefined);
          return;
        }
        sentinelRef.current = sentinel;
        setState("on");
        sentinel.addEventListener("release", () => {
          if (sentinelRef.current === sentinel) setState("off");
        });
      })
      .catch(() => setState("unavailable"));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") request();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      wantedRef.current = false;
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => undefined);
    };
  }, [enabled, request]);

  return { state, request };
}
