import { defineRouting } from "next-intl/routing";

/**
 * `[locale]` scaffolded day one, EN-only content (FRONTEND_SPEC.md §0.6 —
 * this governs the dashboard/marketing UI LANGUAGE only, never the agent's
 * spoken call language, a separate per-tenant setting). `localePrefix:
 * "as-needed"` means the default locale (`en`) carries no `/en` segment in
 * the URL, so every path elsewhere in this app matches FRONTEND_SPEC.md's
 * paths literally — adding a second UI locale later is a content/config
 * change (add to `locales`, add `messages/<locale>.json`), not a routing
 * rewrite.
 */
export const routing = defineRouting({
  locales: ["en"],
  defaultLocale: "en",
  localePrefix: "as-needed",
});
