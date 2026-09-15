/**
 * `@heyloo/ui/audio-player` — the call-detail recording `AudioPlayer` and
 * the raw `Slider` primitive it's built on, kept OUT of the main
 * `@heyloo/ui` barrel. See `custom/index.ts`'s and `primitives/index.ts`'s
 * comments at the exclusion sites, and `index.ts`'s header comment for
 * the `charts`/`command`/`date-range` precedent this mirrors — a real
 * 3rd-party dependency (`@radix-ui/react-slider`) with a single,
 * non-marketing call site (`apps/web/src/components/tenant/
 * call-detail-client.tsx`) has no reason to be reachable from every
 * consumer of the main barrel.
 */

export * from "./custom/audio-player.js";
export * from "./primitives/slider.js";
