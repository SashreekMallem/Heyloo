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
different phone) — this package does **not** call Retell itself (out of
scope for T6; CLAUDE.md Rule 1's docs-first gate on a new external API
integration belongs to whichever task first calls Retell's simulation
endpoints for real).

## Connecting this dataset to Retell's batch-simulation API (future work)

Retell exposes a batch call-simulation capability (`ProviderCapabilities.
supportsBatchSimulationTesting` is already `true` on `RETELL_CAPABILITIES`,
`packages/adapters/retell/src/provider.ts`) that can place many simulated
calls against a **staging** agent and return transcripts/outcomes
(SYSTEM_DESIGN §8: "Staging Retell account for CI/template QA — never test
against prod agents", G16). The intended wiring, once a task owns building
it:

1. **Provision a staging agent per template.** For each `TemplateDefinition`
   in `TEMPLATE_REGISTRY` (`../registry.ts`), compile it
   (`RetellProvider.compileTemplate`) and publish it to the **staging**
   Retell account only — never prod — via `createOrUpdateAgent` +
   `publishAgentVersion`.
2. **Turn each `InjectionFixture` (`injection-fixtures.ts`) into a simulated
   conversation.** Retell's batch-simulation input is (per its docs, to be
   confirmed against the live API before this is built — CLAUDE.md Rule 1)
   a scripted or persona-driven caller turn set against a target agent id.
   Each fixture's `callerTurn` seeds one simulated call; `vertical` selects
   which staging agent to run it against (`"*"` runs against all 8).
3. **Grade the transcript against `expectation`**, not against the model's
   literal wording. Most `expectation`s in this dataset describe a
   STRUCTURAL guarantee that `structural.test.ts` already proves holds
   regardless of what the model says at runtime (e.g. the transfer
   destination literally cannot be caller-supplied because the compiled
   tool has no such parameter) — so the batch-simulation grader's real job
   is to catch the remaining, genuinely model-behavioral risks: did the
   model's SPOKEN response still leak something it shouldn't have (e.g.
   repeating a caller-supplied "corrected" price back as if agreeing to
   it), even though the underlying tool call would have been rejected or
   never fired.
4. **Wire into CI as a gate on template changes**, not on every commit —
   batch simulation costs real Retell minutes. Trigger it in CI when a PR
   touches `packages/templates/src/verticals/**` or `packages/templates/src/
   shared/**`, run it against the staging account from step 1, and fail the
   check on any fixture whose graded transcript violates its `expectation`.
5. **Extend `INJECTION_FIXTURES`** as new attack patterns are discovered in
   production call transcripts (SYSTEM_DESIGN §4.4's `state_trace` +
   `variable_values` fields on `call_logs` are exactly what makes a
   real-world miss reproducible as a new fixture here).

None of the above is implemented in this package — this file exists so the
task that eventually builds the batch-simulation harness has a concrete,
already-typed dataset and a clear connection point instead of starting from
nothing.
