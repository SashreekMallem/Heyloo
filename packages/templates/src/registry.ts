/**
 * The template registry — a single place enumerating all 8 vertical
 * templates as versioned constants (BUILD task item 4), consumable by a
 * future seed script / the provisioning saga (T4/T7) to insert
 * `agent_templates` rows. `key` is the stable slug a seed script keys on;
 * `version` is bumped by hand whenever a template's canonical content
 * changes (mirrors `agent_templates.version` in BACKEND_SPEC §1.3 — the DB
 * row's own version, assigned at insert time, is a separate concern from
 * this package's own "which revision of the authored content is this").
 */

import type { AgentTemplate } from "@heyloo/canonical-types";
import { AUTO_REPAIR_TEMPLATE } from "./verticals/auto-repair.js";
import { DENTAL_TEMPLATE } from "./verticals/dental.js";
import { GENERIC_TEMPLATE } from "./verticals/generic.js";
import { LEGAL_TEMPLATE } from "./verticals/legal.js";
import { MOTEL_TEMPLATE } from "./verticals/motel.js";
import { REAL_ESTATE_TEMPLATE } from "./verticals/real-estate.js";
import { RESTAURANT_TEMPLATE } from "./verticals/restaurant.js";
import { VETERINARY_TEMPLATE } from "./verticals/veterinary.js";

export interface TemplateDefinition {
  /** Stable slug for seed scripts / display — never reused across verticals, independent of the DB row id. */
  key: string;
  name: string;
  version: number;
  template: AgentTemplate;
}

export const TEMPLATE_DEFINITIONS: readonly TemplateDefinition[] = [
  {
    key: "auto_repair",
    name: "Auto Repair — Front Desk",
    version: 1,
    template: AUTO_REPAIR_TEMPLATE,
  },
  {
    // GAP_REGISTER.md §2 Vet item 5: this key previously read "veterinary",
    // diverging from the canonical vertical slug ("vet",
    // `@heyloo/canonical-types` `vertical.ts`, and `VETERINARY_TEMPLATE
    // .vertical` itself) — a landmine for a future seed script/provisioning
    // saga that keys a tenant's `vertical` column against this registry.
    // No other in-repo consumer referenced the old key at runtime (grep
    // confirmed only this package's own tests did — updated alongside).
    key: "vet",
    name: "Veterinary — Front Desk",
    version: 1,
    template: VETERINARY_TEMPLATE,
  },
  { key: "legal", name: "Legal Intake", version: 1, template: LEGAL_TEMPLATE },
  { key: "dental", name: "Dental — Front Desk", version: 1, template: DENTAL_TEMPLATE },
  {
    key: "real_estate",
    name: "Real Estate — Qualification",
    version: 1,
    template: REAL_ESTATE_TEMPLATE,
  },
  { key: "motel", name: "Motel — Front Desk", version: 1, template: MOTEL_TEMPLATE },
  {
    key: "restaurant",
    name: "Restaurant — Orders & Reservations",
    version: 1,
    template: RESTAURANT_TEMPLATE,
  },
  { key: "generic", name: "Generic — Front Desk", version: 1, template: GENERIC_TEMPLATE },
];

export const TEMPLATE_REGISTRY: Readonly<Record<string, TemplateDefinition>> = Object.fromEntries(
  TEMPLATE_DEFINITIONS.map((def) => [def.key, def]),
);

export function getTemplateDefinition(key: string): TemplateDefinition | undefined {
  return TEMPLATE_REGISTRY[key];
}
