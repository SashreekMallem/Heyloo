/**
 * @heyloo/adapter-retell
 *
 * Retell (voice provider) adapter. Exports the `VoiceProvider`
 * implementation and its construction options, plus the batch-simulation
 * `Tests` API wrapper (`tests-api.ts`) — never a raw Retell payload shape
 * (CLAUDE.md Rule 2, packages/adapters/README.md). Every exported return
 * type is canonical/provider-agnostic. Core code should import canonical
 * types from `@heyloo/canonical-types` and depend on the `VoiceProvider`
 * interface there; only the composition root (T3/T4 edge functions) should
 * import `RetellProvider` itself to construct one. `createRetellBatchSimulationClient`
 * is consumed only via a dynamic `import()` from `packages/templates/src/
 * red-team/run-simulation.ts` (see `tests-api.ts`'s header for why that's
 * dynamic, never a static package dependency).
 */

export const ADAPTER_RETELL_VERSION = "0.1.0" as const;

export { RETELL_CAPABILITIES, RetellProvider, type RetellProviderOptions } from "./provider.js";
export {
  type BatchSimulationClient,
  type CreateRetellBatchSimulationClientOptions,
  createRetellBatchSimulationClient,
  encodeResponseEngineRef,
  type RecordedToolCall,
  type RetellResponseEngineRef,
  type SimulationTestCase,
  type SimulationTranscript,
} from "./tests-api.js";
