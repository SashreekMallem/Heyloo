"use client";

import { useEffect, useLayoutEffect } from "react";

/**
 * `useLayoutEffect` on the client (resolves synchronously, before the
 * browser's next paint — what every set piece in this directory needs
 * for a state flip that must land before first paint, e.g.
 * `use-device-capability.ts`'s qualification probe feeding
 * `hero-scroll-scene.tsx`'s CLS-safe pin placeholder), `useEffect`
 * during SSR — `useLayoutEffect` never actually RUNS during SSR (React
 * has no browser to paint before), but merely calling it from a
 * component the server renderer processes prints React's own "useLayoutEffect
 * does nothing on the server" dev warning on every request. Aliasing to
 * `useEffect` server-side (`typeof window === "undefined"`) is the
 * standard fix (the same pattern used by Redux/Framer Motion/MUI) —
 * silences the warning with no behavior change, since SSR never runs
 * either hook's callback anyway.
 */
export const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
