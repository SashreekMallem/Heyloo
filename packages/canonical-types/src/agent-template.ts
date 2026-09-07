/**
 * The canonical AgentTemplate schema (BACKEND_SPEC §1.3) plus its
 * MASTER_SPEC §3.5 per-vertical `dynamic_variable_overrides` extensions and
 * §3.6 consent shape.
 *
 * This is validated by Zod before every `agent_templates` insert AND by the
 * compiler (`packages/adapters/retell`) before every provider publish
 * (BACKEND_SPEC §1.3: "validated by a Zod schema in packages/canonical-types
 * before insert, and by the compiler before every Retell publish").
 *
 * Nothing in this file may import or reference a provider-specific shape
 * (CLAUDE.md Rule 2) — the compiler lowers `AgentTemplate` into a provider
 * payload entirely inside `packages/adapters/<provider>`.
 */

import { z } from "zod";
import { zCents, zE164, zIsoTimestamp } from "./primitives.js";
import { zVertical } from "./vertical.js";

// ---------------------------------------------------------------------------
// State graph primitives
// ---------------------------------------------------------------------------

/** Slug, unique within a template. */
export const zStateId = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_]*$/, "state id must be a lowercase slug, e.g. 'collect_time'");
export type StateId = z.infer<typeof zStateId>;

export const EXTRACTION_FIELD_TYPES = ["boolean", "text", "number", "enum"] as const;
export type ExtractionFieldType = (typeof EXTRACTION_FIELD_TYPES)[number];

export const zExtractionField = z
  .object({
    field: z.string().min(1),
    type: z.enum(EXTRACTION_FIELD_TYPES),
    enum_values: z.array(z.string().min(1)).optional(),
  })
  .check((ctx) => {
    if (
      ctx.value.type === "enum" &&
      (!ctx.value.enum_values || ctx.value.enum_values.length === 0)
    ) {
      ctx.issues.push({
        code: "custom",
        message: "enum extraction fields must declare a non-empty enum_values list",
        input: ctx.value,
        path: ["enum_values"],
      });
    }
  });
export type ExtractionField = z.infer<typeof zExtractionField>;

export const zAgentState = z.object({
  id: zStateId,
  name: z.string().min(1),
  prompt_fragment: z.string().min(1),
  allowed_tools: z.array(z.string().min(1)),
  entry_conditions: z.array(z.string()).optional(),
  extraction: z.array(zExtractionField).optional(),
  is_terminal: z.boolean().optional(),
});
export type AgentState = z.infer<typeof zAgentState>;

export const zTransitionCondition = z
  .object({
    intent: z.string().min(1).optional(),
    predicate: z.string().min(1).optional(),
  })
  .refine((c) => c.intent !== undefined || c.predicate !== undefined, {
    message: "a transition's `on` must specify at least one of intent/predicate",
  });

export const zTransition = z.object({
  from: zStateId,
  to: zStateId,
  on: zTransitionCondition,
  priority: z.number().int().optional(),
});
export type Transition = z.infer<typeof zTransition>;

/**
 * `reachable_from: "any"` structurally guarantees the escape is reachable
 * from every state — never model-discretionary (SYSTEM_DESIGN §4.1, the vet
 * emergency global node being the canonical example).
 */
export const zGlobalIntentReachableFrom = z.union([z.literal("any"), z.array(zStateId).min(1)]);

export const zGlobalIntent = z.object({
  name: z.string().min(1), // "emergency" | "human_request" | "solicitor" | tenant/vertical-specific extensions
  reachable_from: zGlobalIntentReachableFrom,
  target_state: zStateId,
  description: z.string().min(1),
});
export type GlobalIntent = z.infer<typeof zGlobalIntent>;

/** Well-known global intent names every template SHOULD wire (SYSTEM_DESIGN §4.5 escalation triggers). */
export const WELL_KNOWN_GLOBAL_INTENTS = ["emergency", "human_request", "solicitor"] as const;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const TOOL_AUTHORIZATION_SCOPES = ["caller_number", "tenant_config_only", "none"] as const;
export type ToolAuthorizationScope = (typeof TOOL_AUTHORIZATION_SCOPES)[number];

/**
 * JSON-Schema (draft-07 subset Retell accepts) describing a tool's
 * parameters. Kept deliberately loose (`z.record`) — this package validates
 * template STRUCTURE, not arbitrary JSON-Schema correctness; the compiler is
 * responsible for rejecting anything a target provider can't lower.
 */
export const zJsonSchemaObject = z.looseObject({
  type: z.literal("object"),
  properties: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  required: z.array(z.string()).optional(),
});
export type JsonSchemaObject = z.infer<typeof zJsonSchemaObject>;

export const zCanonicalTool = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  parameters: zJsonSchemaObject,
  authorization: z.object({
    scope: z.enum(TOOL_AUTHORIZATION_SCOPES),
  }),
});
export type CanonicalTool = z.infer<typeof zCanonicalTool>;

// ---------------------------------------------------------------------------
// Compile targets (SYSTEM_DESIGN §4.1)
// ---------------------------------------------------------------------------

export const COMPILE_TARGETS = ["conversation_flow", "multi_prompt", "single_prompt"] as const;
export type CompileTarget = (typeof COMPILE_TARGETS)[number];
export const zCompileTarget = z.enum(COMPILE_TARGETS);

// ---------------------------------------------------------------------------
// AgentTemplate — the canonical jsonb content (BACKEND_SPEC §1.3)
// ---------------------------------------------------------------------------

export const zAgentTemplate = z
  .object({
    vertical: zVertical.or(z.string().min(1)), // `vertical` column also accepts 'generic' + future verticals
    compile_target: zCompileTarget,
    system_prompt: z.string().min(1).optional(),
    states: z.array(zAgentState),
    transitions: z.array(zTransition),
    global_intents: z.array(zGlobalIntent),
    tools: z.array(zCanonicalTool),
    /** Compiler-enforced constant text fragment; NEVER tenant-editable (G1/G2). */
    disclosure_line: z.string().min(1),
  })
  .check((ctx) => {
    const t = ctx.value;
    const stateIds = new Set(t.states.map((s) => s.id));
    if (stateIds.size !== t.states.length) {
      ctx.issues.push({
        code: "custom",
        message: "state ids must be unique within a template",
        input: t,
        path: ["states"],
      });
    }
    const toolNames = new Set(t.tools.map((tool) => tool.name));
    if (toolNames.size !== t.tools.length) {
      ctx.issues.push({
        code: "custom",
        message: "tool names must be unique within a template",
        input: t,
        path: ["tools"],
      });
    }
    for (const [i, state] of t.states.entries()) {
      for (const [j, toolName] of state.allowed_tools.entries()) {
        if (!toolNames.has(toolName)) {
          ctx.issues.push({
            code: "custom",
            message: `state '${state.id}' allows unknown tool '${toolName}' (not declared in tools[])`,
            input: state,
            path: ["states", i, "allowed_tools", j],
          });
        }
      }
    }
    for (const [i, transition] of t.transitions.entries()) {
      if (!stateIds.has(transition.from)) {
        ctx.issues.push({
          code: "custom",
          message: `transition[${i}].from '${transition.from}' is not a declared state`,
          input: transition,
          path: ["transitions", i, "from"],
        });
      }
      if (!stateIds.has(transition.to)) {
        ctx.issues.push({
          code: "custom",
          message: `transition[${i}].to '${transition.to}' is not a declared state`,
          input: transition,
          path: ["transitions", i, "to"],
        });
      }
    }
    for (const [i, gi] of t.global_intents.entries()) {
      if (!stateIds.has(gi.target_state)) {
        ctx.issues.push({
          code: "custom",
          message: `global_intents[${i}].target_state '${gi.target_state}' is not a declared state`,
          input: gi,
          path: ["global_intents", i, "target_state"],
        });
      }
      if (gi.reachable_from !== "any") {
        for (const [j, from] of gi.reachable_from.entries()) {
          if (!stateIds.has(from)) {
            ctx.issues.push({
              code: "custom",
              message: `global_intents[${i}].reachable_from[${j}] '${from}' is not a declared state`,
              input: gi,
              path: ["global_intents", i, "reachable_from", j],
            });
          }
        }
      }
    }
    if (t.compile_target === "single_prompt" && !t.system_prompt) {
      ctx.issues.push({
        code: "custom",
        message: "single_prompt targets require a non-empty system_prompt",
        input: t,
        path: ["system_prompt"],
      });
    }
    if (t.states.length === 0 && t.compile_target !== "single_prompt") {
      ctx.issues.push({
        code: "custom",
        message: `compile_target '${t.compile_target}' requires at least one state`,
        input: t,
        path: ["states"],
      });
    }
  });
export type AgentTemplate = z.infer<typeof zAgentTemplate>;

/** Full `agent_templates` row (BACKEND_SPEC §1.3 table) — template content plus DB/versioning metadata. */
export const zAgentTemplateRecord = z.object({
  id: z.uuid(),
  vertical: zVertical.or(z.string().min(1)),
  name: z.string().min(1),
  version: z.number().int().positive(),
  compile_target: zCompileTarget,
  system_prompt: z.string().min(1).nullable(),
  states: z.array(zAgentState),
  transitions: z.array(zTransition),
  global_intents: z.array(zGlobalIntent),
  tools: z.array(zCanonicalTool),
  voice_id: z.string().min(1),
  model: z.string().min(1),
  disclosure_line: z.string().min(1),
  is_active: z.boolean(),
  created_by: z.uuid().nullable(),
  created_at: zIsoTimestamp,
});
export type AgentTemplateRecord = z.infer<typeof zAgentTemplateRecord>;

// ---------------------------------------------------------------------------
// MASTER_SPEC §3.5 — per-vertical `agent_configs.dynamic_variable_overrides`
// ---------------------------------------------------------------------------

export const zCancellationPolicy = z.object({
  window_hours: z.number().int().nonnegative(),
  fee_cents: zCents.optional(),
  text: z.string().min(1),
});
export type CancellationPolicy = z.infer<typeof zCancellationPolicy>;

const zContact = z.object({ name: z.string().min(1), phone: zE164 });

/** Fields common to every vertical — the salvaged rich-context fields (BACKEND_SPEC §1.3). */
const zBaseDynamicVariableOverrides = z.object({
  manager_name: z.string().min(1).optional(),
  manager_phone: zE164.optional(),
  parking_info: z.string().min(1).optional(),
  accessibility_notes: z.string().min(1).optional(),
  prep_time_minutes: z.number().int().nonnegative().optional(),
  accepted_payment_types: z.array(z.string().min(1)).optional(),
  cancellation_policy: zCancellationPolicy.optional(),
});

export const zDentalOverrides = zBaseDynamicVariableOverrides.extend({
  insurances_accepted: z.array(z.string().min(1)).optional(),
});

export const zVetOverrides = zBaseDynamicVariableOverrides.extend({
  species_treated: z.array(z.string().min(1)).optional(),
  emergency_referral: zContact.optional(),
});

export const zAutoOverrides = zBaseDynamicVariableOverrides.extend({
  tow_partner: zContact.optional(),
  vehicle_makes_serviced: z.array(z.string().min(1)).optional(),
});

export const zLegalOverrides = zBaseDynamicVariableOverrides.extend({
  practice_areas: z.array(z.string().min(1)).optional(),
  consult_fee_cents: zCents.optional(),
});

export const zMotelOverrides = zBaseDynamicVariableOverrides.extend({
  deposit_policy: z
    .object({
      required: z.boolean(),
      amount_cents: zCents.optional(),
      hold_window_hours: z.number().int().nonnegative().optional(),
      text: z.string().min(1),
    })
    .optional(),
  rate_table: z
    .array(z.object({ room_type: z.string().min(1), nightly_rate_cents: zCents }))
    .optional(),
});

export const zRestaurantOverrides = zBaseDynamicVariableOverrides.extend({
  delivery_radius_m: z.number().int().positive().optional(),
  min_order_cents: zCents.optional(),
});

export const zRealEstateOverrides = zBaseDynamicVariableOverrides;
export const zGenericOverrides = zBaseDynamicVariableOverrides;

export type DentalOverrides = z.infer<typeof zDentalOverrides>;
export type VetOverrides = z.infer<typeof zVetOverrides>;
export type AutoOverrides = z.infer<typeof zAutoOverrides>;
export type LegalOverrides = z.infer<typeof zLegalOverrides>;
export type MotelOverrides = z.infer<typeof zMotelOverrides>;
export type RestaurantOverrides = z.infer<typeof zRestaurantOverrides>;
export type RealEstateOverrides = z.infer<typeof zRealEstateOverrides>;
export type GenericOverrides = z.infer<typeof zGenericOverrides>;

export type DynamicVariableOverrides =
  | DentalOverrides
  | VetOverrides
  | AutoOverrides
  | LegalOverrides
  | MotelOverrides
  | RestaurantOverrides
  | RealEstateOverrides
  | GenericOverrides;

/** Vertical -> the Zod schema validating that vertical's `dynamic_variable_overrides` (MASTER_SPEC §3.5). */
export function dynamicVariableOverridesSchemaForVertical(
  vertical: string,
): z.ZodType<DynamicVariableOverrides> {
  switch (vertical) {
    case "dental":
      return zDentalOverrides;
    case "vet":
      return zVetOverrides;
    case "auto":
      return zAutoOverrides;
    case "legal":
      return zLegalOverrides;
    case "motel":
      return zMotelOverrides;
    case "restaurant":
      return zRestaurantOverrides;
    case "real_estate":
      return zRealEstateOverrides;
    default:
      return zGenericOverrides;
  }
}

// ---------------------------------------------------------------------------
// MASTER_SPEC §3.6 — transactional-outbound consent shape (`customers.consent`)
// ---------------------------------------------------------------------------

export const zConsent = z.object({
  sms: z.boolean(),
  call: z.boolean(),
  captured_at: zIsoTimestamp,
  call_id: z.string().min(1),
});
export type Consent = z.infer<typeof zConsent>;
