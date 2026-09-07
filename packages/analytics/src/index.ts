/**
 * `trackEvent` (FRONTEND_SPEC.md §0.8) — the ONE call site every client
 * component uses; never call `posthog.capture` directly elsewhere, so
 * swapping providers is a one-file change. Event names are `snake_case`,
 * `noun_verb` or `domain_action` (`demo_started`, `booking_rescheduled`).
 * Never imported from a Server Component — server-side conversion events
 * (e.g. a Stripe webhook firing `subscription_created`) are emitted from
 * the edge function that fires them instead, to avoid double-counting or
 * being lost to an ad-blocker.
 */
import { posthog } from "posthog-js";

let initialized = false;

export function initAnalytics(apiKey: string, apiHost: string): void {
  if (initialized || typeof window === "undefined") return;
  posthog.init(apiKey, {
    api_host: apiHost,
    capture_pageview: false,
    person_profiles: "identified_only",
  });
  initialized = true;
}

export function trackEvent(name: string, props?: Record<string, unknown>): void {
  if (!initialized || typeof window === "undefined") return;
  posthog.capture(name, props);
}

export function identifyUser(userId: string, traits?: Record<string, unknown>): void {
  if (!initialized || typeof window === "undefined") return;
  posthog.identify(userId, traits);
}
