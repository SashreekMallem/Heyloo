/**
 * @heyloo/adapter-retell
 *
 * Retell (voice provider) adapter. Exports ONLY the `VoiceProvider`
 * implementation and its construction options — never a Retell payload
 * shape (CLAUDE.md Rule 2, packages/adapters/README.md). Core code should
 * import canonical types from `@heyloo/canonical-types` and depend on the
 * `VoiceProvider` interface there; only the composition root (T3/T4 edge
 * functions) should import `RetellProvider` itself to construct one.
 */

export const ADAPTER_RETELL_VERSION = "0.1.0" as const;

export { RETELL_CAPABILITIES, RetellProvider, type RetellProviderOptions } from "./provider.js";
