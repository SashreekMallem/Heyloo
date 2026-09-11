/**
 * @heyloo/templates
 *
 * The 8 vertical agent templates (auto repair, veterinary, legal, dental,
 * real estate, motel, restaurant, generic) in canonical `AgentTemplate`
 * format (SYSTEM_DESIGN §4.1-§4.3), the shared prompt-fragment/tool/global-
 * intent building blocks they're built from, and the `TEMPLATE_REGISTRY`
 * a seed script or the provisioning saga consumes. See `red-team/` for the
 * adversarial structural-guarantee test suite and its injection-fixture
 * dataset (README there documents the future Retell batch-simulation CI
 * gate).
 */

export const TEMPLATES_PACKAGE_VERSION = "1.0.0" as const;

export * from "./registry.js";
export * from "./shared/disclosure.js";
export * from "./shared/fragments.js";
export * from "./shared/global-intents.js";
export * from "./shared/system-prompt.js";
export * from "./shared/text-persona.js";
export * from "./shared/tools.js";
export * from "./shared/utility-states.js";
export * from "./verticals/auto-repair.js";
export * from "./verticals/dental.js";
export * from "./verticals/generic.js";
export * from "./verticals/legal.js";
export * from "./verticals/motel.js";
export * from "./verticals/real-estate.js";
export * from "./verticals/restaurant.js";
export * from "./verticals/veterinary.js";
