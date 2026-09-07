/**
 * @heyloo/canonical-types
 *
 * Provider-agnostic types shared across the platform: the abstract voice
 * agent state graph, tenant/domain models, and tool contracts (SYSTEM_DESIGN
 * §3, §4, §6). Real schemas land in T2 (canonical agent template + tool
 * contracts) and T1 (data model types). This placeholder only proves the
 * package builds, is importable, and is versioned.
 *
 * Rule (CLAUDE.md, Rule 2): this package must never import a provider SDK
 * (e.g. `retell-sdk`, `twilio`, `stripe`) or reference provider-specific
 * payload shapes. Provider isolation lives entirely in packages/adapters/*.
 */

export const CANONICAL_TYPES_VERSION = "0.0.0" as const;
