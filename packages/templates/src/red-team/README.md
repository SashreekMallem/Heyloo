# Red-team suite

`structural.test.ts` proves a set of structural guarantees directly against
the canonical `AgentTemplate` schema (`@heyloo/canonical-types`) for all 8
vertical templates: disclosure-line composition, `emergency`/`human_request`/
`solicitor` global intents present and `reachable_from: "any"` on every
template, `lookup_customer` scoped to `caller_number`, `transfer_call` never
accepting a caller-suppliable destination, the legal no-advice guardrail +
`legal_advice_given` extraction on every legal state, the consent ask/
cancellation-policy/identity-fallback/waitlist-offer fragments present
wherever their triggering condition applies, and a static
template-injection lint (`prompt-lint.ts`) over every prompt fragment and
tool description.

`compiler-gate.test.ts` covers the one guarantee that genuinely requires
running the compiler rather than reading the canonical schema: that every
template's compiled output passes the disclosure-line publish gate for its
own `compile_target`. It calls `RetellProvider.compileTemplate` — the public
`VoiceProvider` method from `@heyloo/adapter-retell` — and asserts only the
canonical `disclosureVerified` boolean, never inspecting the Retell-shaped
`providerPayload` (CLAUDE.md Rule 2: provider-specific payload shapes stay
inside `packages/adapters/*`).

`injection-fixtures.ts` is a small, typed dataset of adversarial caller-turn
strings ("ignore all previous instructions...", asking to look up a
different phone number, asking for a transfer to a caller-supplied number,
fishing for legal advice or PHI, disputing a price against the tool-backed
catalog/rate table, downplaying a vet emergency, asserting identity from a
different phone).

`simulation-scenarios.ts` is the non-adversarial half of the same seed
corpus: short scripted caller-turn sequences for every other register
scenario Cluster F's task named — happy path, the caller changing their
mind mid-call, no availability, an out-of-delivery-radius decline, an
emergency/red-flag, the caller going silent, a non-English caller, and an
explicit transfer request — one or more per applicable vertical (or `"*"`
for a vertical-agnostic scenario).

Every entry in both datasets carries TWO things describing the guarantee it
proves: a human-readable `expectation` (prose, for anyone reading the
dataset) and a machine-gradable `expect(template)` returning a
`SimulationAssertion` (`simulation-types.ts`) — `tool_called`/
`tool_not_called`/`tool_called_with_zero_params`, `state_reached`/
`state_not_reached`, `first_utterance_contains`, `agent_never_says`,
`no_forbidden_fields`, composed with `all`/`any`, or (for the one
guarantee — `silence_voicemail`'s response-timing ladder — no
tool-call/state signal can prove) `manual_review`. `grader.ts`'s
`gradeTranscript` checks the LATTER against a real `SimulationTranscript`,
never the prose (`grader.test.ts` proves every assertion kind both passes a
satisfying transcript and fails a violating one). Most `expect` assertions
re-check, at the transcript level, a guarantee `structural.test.ts` already
proves at the canonical-template level — the harness's real job is the
remaining model-behavioral risk, not re-deriving structural guarantees this
suite already covers.

## The batch-simulation harness — `run-simulation.ts`

**Status: the harness is real.** `run-simulation.ts`'s `runHarness` — for
every registered `TemplateDefinition` (`../registry.ts`) — compiles it via
`RetellProvider.compileTemplate` (proving the disclosure-line publish gate
first, same as `compiler-gate.test.ts`), builds one `SimulationTestCase` per
applicable scenario/fixture (`scenarioAppliesTo`/`fixtureAppliesTo` decide
applicability: an exact vertical match, or — for a `"*"` wildcard — every
template not already covered by its own specific entry of that category,
further tool-gated per category, e.g. `no_availability` only applies where
`check_availability` is actually declared), submits them through an
injected `BatchSimulationClient`, and grades every returned transcript with
`gradeTranscript`. This is exercised end-to-end in `run-simulation.test.ts`
against an in-memory mock client — including a genuine discrimination
check (one template deliberately fed empty/wrong transcripts, proving the
harness reports real failures, not a fabricated green).

**Update (WAVE-2 integration pass): the one seam is closed.** A real
`BatchSimulationClient` implementation wrapping Retell's `Tests` API now
exists — `createRetellBatchSimulationClient`,
`packages/adapters/retell/src/tests-api.ts`, exported from that package's
`index.ts` (`client.tests.createTestCaseDefinition`/`createBatchTest`/
`listTestRuns` shape confirmed against both the official `retell-sdk` npm
package's own generated source AND a live `docs.retellai.com` fetch this
pass, `VERIFY-13` in `docs/VERIFY.md`). `run-simulation.ts`'s CLI entry
point (`pnpm --filter @heyloo/templates run simulate`) now dynamic-`import()`s
it and, given `RETELL_API_KEY` plus a `RETELL_STAGING_RESPONSE_ENGINE_<KEY>`
per template, can run a real batch. **Still open, per `VERIFY-13`'s own
standing note:** the wrapper's `transcript_snapshot` normalizer is written
against the closest officially-documented sibling shape (the SDK's `Call`
resource `transcript_with_tool_calls` union) because Retell's own SDK types
that field `unknown` on purpose and no reachable documentation shows an
example payload — it fails loudly, never silently, the moment a real
payload doesn't match. A live staging call to see one actual
`transcript_snapshot` and confirm/correct that parser is the one action
item left before trusting a green run. Per-vertical dynamic variables
(`{{business_name}}`, `{{rate_table}}`, etc.) sourced from real/representative
tenant config, rather than left unset for the simulated call, is a separate,
still-open refinement.

Run the unit-tested harness today with:
```
pnpm --filter @heyloo/templates test          # grader.test.ts + run-simulation.test.ts, no secret needed
pnpm --filter @heyloo/templates build          # compiles run-simulation.ts to dist/
pnpm --filter @heyloo/templates run simulate   # the real CLI — fails closed without RETELL_API_KEY + the adapter export above
```

## Connecting to Retell's batch-simulation API for real — what's left

Retell exposes a batch call-simulation capability (`ProviderCapabilities.
supportsBatchSimulationTesting` is already `true` on `RETELL_CAPABILITIES`,
`packages/adapters/retell/src/provider.ts`; its real shape is Retell's
`Tests` resource, `client.tests.*`, confirmed via the official `retell-sdk`
npm package's own generated source — `VERIFY-13`, `docs/VERIFY.md`) that
can place many simulated calls against a **staging** agent and return
transcripts/outcomes (SYSTEM_DESIGN §8: "Staging Retell account for CI/
template QA — never test against prod agents", G16). Everything up to and
including "provision a staging agent, submit a scenario, grade the
transcript" is now IMPLEMENTED (`run-simulation.ts`, the section above) —
the one remaining step is the actual provider wrapper:

1. ~~Provision a staging agent per template.~~ **Done** —
   `run-simulation.ts`'s `runHarness` already compiles every template via
   `RetellProvider.compileTemplate`; publishing that compiled artifact to a
   staging Retell account via `createOrUpdateAgent`/`publishAgentVersion`
   (both already canonical `VoiceProvider` methods, `packages/adapters/
   retell/src/agents.ts`) to obtain each template's `responseEngineRef` is
   the caller's job (e.g. a small provisioning script in CI, run once per
   template-content change) — `runHarness` itself takes that mapping as an
   input (`responseEngineRefs`), not something it resolves itself.
2. ~~Turn each fixture/scenario into a simulated conversation.~~ **Done** —
   `buildPersonaPrompt` turns a `callerTurn`/`callerTurns` script into the
   PERSONA prompt Retell's `Tests.createTestCaseDefinition`'s `user_prompt`
   expects (confirmed via `tests.d.ts`: an LLM-driven simulated caller
   follows this persona for the whole call, not a literal fixed script).
3. ~~Grade the transcript against `expectation`.~~ **Done, and no longer
   prose** — every scenario/fixture now carries `expect(template)`, a
   machine-gradable `SimulationAssertion` (`simulation-types.ts`), checked
   by `gradeTranscript` (`grader.ts`) against the real
   `SimulationTranscript` a `BatchSimulationClient` returns.
4. **Wire into CI as a gate on template changes**, not on every commit —
   batch simulation costs real Retell minutes. Sketch filed as a
   cross-cluster request (`docs/audit/FIX_REQUESTS.md`, since
   `.github/workflows/**` is outside this cluster's ownership): gate on
   `packages/templates/src/verticals/**`/`packages/templates/src/shared/**`
   changes, conditioned on a staging secret being present so it's SKIPPED
   (not red) until that secret and item 5 below both exist.
5. ~~The one thing NOT done: `createRetellBatchSimulationClient`~~ **Done
   (WAVE-2 integration pass)** — `packages/adapters/retell/src/tests-api.ts`,
   exported from that package's `index.ts`. `run-simulation.ts`'s CLI
   (`pnpm --filter @heyloo/templates run simulate`) still fails closed with
   an explicit, actionable error whenever `RETELL_API_KEY` is unset or a
   template has no `RETELL_STAGING_RESPONSE_ENGINE_<KEY>` configured — it
   never fabricates a pass. One piece of the wrapper itself remains
   unconfirmed pending a live account run — see the "Update" note above and
   `VERIFY-13`.
6. **Extend `INJECTION_FIXTURES`/`SIMULATION_SCENARIOS`** as new attack
   patterns or scenarios are discovered in production call transcripts
   (SYSTEM_DESIGN §4.4's `state_trace` + `variable_values` fields on
   `call_logs` are exactly what makes a real-world miss reproducible as a
   new fixture here) — every new entry needs both a human `expectation`
   and a machine-gradable `expect(template)`; `structural.test.ts`'s
   "only references real tools/states" check catches a typo'd tool/state
   name in a new `expect` before it ever reaches a live run.
