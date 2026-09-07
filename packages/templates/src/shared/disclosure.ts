/**
 * The mandatory, non-removable opening disclosure (SYSTEM_DESIGN §4.5 /
 * MASTER_SPEC §3.6 preface / CLAUDE.md Rule 2: "Every agent greeting
 * includes the compiled-in AI + recording disclosure"). Composes the
 * tenant's `assistant_name` persona (SYSTEM_DESIGN §14 salvage: "owner
 * names their AI; composes with the mandatory disclosure") with
 * `business_name` — both resolved from `agent_configs.dynamic_variable_overrides`
 * / `AgentDynamicVariables` (canonical-types) at call time, never
 * tenant-editable as free text (G1/G2).
 *
 * Every one of the 8 templates uses this EXACT constant as its
 * `disclosure_line`. Wording-per-vertical is an explicit SYSTEM_DESIGN §15
 * open owner decision ("warmth vs legal-safety") — presence is not, so
 * until that decision lands, one shared, compliant wording is used
 * everywhere rather than 8 slightly-different hand-authored strings that
 * would be harder to audit for the two-party-consent + AI-disclosure
 * requirements this line exists to satisfy.
 */

export const DISCLOSURE_LINE =
  "Thanks for calling {{business_name}}. This is {{assistant_name}}, their AI assistant — this call may be recorded.";
