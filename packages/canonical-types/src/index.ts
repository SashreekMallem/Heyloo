/**
 * @heyloo/canonical-types
 *
 * Provider-agnostic types shared across the platform: money/phone/timestamp
 * primitives, the canonical AgentTemplate schema (BACKEND_SPEC §1.3, MASTER_SPEC
 * §3.5/§3.6), the VoiceProvider interface + portability shapes (SYSTEM_DESIGN
 * §3), the 12-class call taxonomy (SYSTEM_DESIGN §4.2), voice tool
 * request/response contracts (BACKEND_SPEC §7.2, MASTER_SPEC §3.0/§3.2), and
 * webhook event envelopes.
 *
 * Rule (CLAUDE.md, Rule 2): this package must never import a provider SDK
 * (e.g. `retell-sdk`, `twilio`, `stripe`) or reference provider-specific
 * payload shapes. Provider isolation lives entirely in packages/adapters/*.
 */

export const CANONICAL_TYPES_VERSION = "0.1.0" as const;

export * from "./agent-template.js";
export * from "./call-taxonomy.js";
export * from "./errors.js";
export * from "./primitives.js";
export * from "./tools.js";
export * from "./vertical.js";
export * from "./voice-provider.js";
export * from "./webhooks.js";
