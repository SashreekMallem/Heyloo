/**
 * Prompt-fragment constants shared across every vertical template
 * (BUILD task item 2). These encode SYSTEM_DESIGN §4.5 (silence/give-up/
 * escalation), §4.3's "one field at a time / digit-by-digit read-back"
 * input-collection rule, MASTER_SPEC §3.6 (consent ask), §3.5
 * (cancellation-policy read-out), and §3.7 (identity fallback) as REUSABLE
 * text — authored once, embedded verbatim into every template's
 * `system_prompt` (conversation_flow/multi_prompt `global_prompt` /
 * single_prompt preamble) so a wording fix lands everywhere at once
 * instead of drifting across 8 hand-copied strings.
 *
 * These are plain string constants with no caller-content interpolation —
 * the red-team prompt-injection lint (`red-team/prompt-lint.test.ts`)
 * verifies exactly that.
 */

// ---------------------------------------------------------------------------
// SYSTEM_DESIGN §4.5 — silence handling
// ---------------------------------------------------------------------------

// SPEED-1: the timing itself is Retell's (agent `reminder_trigger_ms` /
// `end_call_after_silence_ms`, set at publish); the model cannot wait N
// seconds, so this only says what to say.
export const SILENCE_HANDLING_FRAGMENT =
  'If the caller goes quiet, nudge once in a few words ("Still there?"). Do not treat ' +
  'backchannels ("mm-hmm", "okay", "yeah") as interruptions.';

// ---------------------------------------------------------------------------
// SYSTEM_DESIGN §4.5 — give-up ladder + escalation triggers
// ---------------------------------------------------------------------------

export const GIVE_UP_LADDER_FRAGMENT =
  "If you can't understand one detail after 2 tries, turn it into a yes/no or either/or " +
  "question; after 3 misunderstandings in the call, stop and transfer or take a message " +
  "instead of guessing.";

export const ESCALATION_TRIGGERS_FRAGMENT =
  "Escalate to a human (transfer if available, otherwise take a message) when the caller asks " +
  "for a person, manager or owner; sounds angry or very distressed; wants something you may " +
  "not give (legal advice, a diagnosis, an unlisted price or promise); describes an " +
  "emergency; or you can't continue in their language.";

export const WARM_TRANSFER_FRAGMENT =
  "Every transfer to a human is a warm transfer: silently prepare a short " +
  "context summary (who is calling, why, and what has already been discussed) " +
  "so the caller is connected with that context already known and never has " +
  "to repeat themselves.";

export const LOW_CONFIDENCE_FIELD_FRAGMENT =
  "Unsure you heard a key detail right (name, number, date, time, address)? Check just that " +
  "detail; if still unclear, ask them to spell it, or — only if the Text messages right now " +
  "line below says texting is available — offer a secure link to type it. Never guess.";

// ---------------------------------------------------------------------------
// SYSTEM_DESIGN §4.3 — input collection discipline
// ---------------------------------------------------------------------------

// SPEED-1 (docs/BUILD_NOTES.md): replaces "one field at a time, confirm each
// one" — on recorded calls that rule alone roughly doubled the AI's turns
// (ask + confirm per field, then a full recap again). The backend still
// refuses a booking/order/message with a required detail missing
// (`_shared/vertical-intake.ts`), so speed never costs completeness.
export const CONVERSATION_PACE_FRAGMENT =
  "Pace: every minute costs the business and callers hate repeating themselves. Keep each " +
  'reply to one or two short sentences, with no filler ("Great!", "Absolutely, I\'d be ' +
  'happy to help"). Callers give details in any order, wording or format, often several at ' +
  "once: keep everything said anywhere in the call and ask only for what is still missing, " +
  "never for something already said. Two closely related details may share one question " +
  '("the year, make and model?"). Don\'t repeat answers back as you go; details are read back ' +
  "once, together, before anything is saved. Convert what they say into what the tools need " +
  'yourself (spoken numbers into digits, "next Tuesday after lunch" into a real date and ' +
  "time, a misheard word into the closest real option); never ask for a particular format.";

/**
 * SPEED-1: how every booking/order/message step words "name and number", so
 * the callback number comes from caller ID (one yes) instead of being
 * dictated digit by digit. The caller-ID value itself and the exact
 * question are the compiler's (`{{caller_number}}`, global prompt).
 */
export const CONTACT_DETAILS =
  "their name and a callback number (per the Caller ID rule: normally just confirm the number " +
  "they're calling from)";

export const DIGIT_BY_DIGIT_READBACK_FRAGMENT =
  "In that one read-back, say a phone number the caller spoke in groups (3, 3, then 4 " +
  'digits) and say dates as day and date ("Tuesday, October 6th at 9 AM"). Never read back ' +
  'a caller-ID number digit by digit — call it "the number you\'re calling from".';

// CALL-2 (docs/BUILD_NOTES.md): confirmed live that with no absolute-date
// anchor anywhere in the prompt, the model resolves "tomorrow"/"next
// Monday" against its own training-era sense of "today" (observed calling
// check_availability with a `date_range` in 2024, checked against a
// database whose availability_slots only cover the real current window —
// `none_available: true` every time, which the model then hallucinated a
// booking confirmation for instead of properly reporting, before looping).
// `{{current_date}}`/`{{current_weekday}}` are Retell's own `{{token}}`
// dynamic-variable substitution (already used elsewhere, e.g.
// `{{vehicle_makes_serviced}}`) — `voice-inbound/dynamic-variables.ts` and
// `api-admin-run-agent-tests` both set these now.
export const CURRENT_DATE_FRAGMENT =
  "Today is {{current_date}} ({{current_weekday}}), timezone {{timezone}}. Resolve relative " +
  'dates ("tomorrow", "next Monday") against this date, never a guess: look weekday names up ' +
  'in {{upcoming_weekday_dates}} (the next 7 days, "Monday=YYYY-MM-DD, ...") instead of ' +
  "counting, and pass absolute date_range values to check_availability.";

// ---------------------------------------------------------------------------
// MASTER_SPEC §3.6 — transactional-outbound consent ask
// ---------------------------------------------------------------------------

// SPEED-1: the consent ask rides on the single read-back instead of being
// its own turn; it is still asked once, explicitly, and never assumed.
export const CONSENT_ASK_FRAGMENT =
  "Before saving a booking or order, read the details back once and, in the same turn, ask " +
  'if it\'s right and "Is it okay to text or call you about this?" (if the Text messages ' +
  'right now line below says texting is not available, ask "Is it okay to call you about ' +
  'this?" and pass sms as false). A clear yes answers both; if they correct something, read ' +
  "back only the change. Pass the answer as `consent` (sms/call, true only if they said yes) " +
  "on the booking or order tool call. Ask once per call, and never assume a yes.";

// ---------------------------------------------------------------------------
// MASTER_SPEC §3.5 — cancellation-policy read-out
// ---------------------------------------------------------------------------

export const CANCELLATION_POLICY_READOUT_FRAGMENT =
  "Mention the cancellation policy ({{cancellation_policy_text}}) as one short clause in that " +
  "read-back for a new booking, and again if they cancel or reschedule — never skip it or " +
  "change its terms.";

// ---------------------------------------------------------------------------
// MASTER_SPEC §3.7 — identity fallback (caller number != booking's own number)
// ---------------------------------------------------------------------------

export const IDENTITY_FALLBACK_FRAGMENT =
  "If the caller wants to reschedule or cancel a booking but the number " +
  "they're calling from doesn't match the number on the booking, verify them " +
  "first: ask for BOTH their full name AND the exact date/time of the " +
  "appointment they believe they have, and pass both as `verify` on the tool " +
  "call. Never proceed on a name alone or a time alone. If verification fails " +
  "twice, stop trying to change the booking and take a message for staff to " +
  "call back instead. Never read back any other personal details while " +
  "verifying identity.";

// ---------------------------------------------------------------------------
// MASTER_SPEC §3.4 — waitlist offer on none_available
// ---------------------------------------------------------------------------

export const WAITLIST_OFFER_FRAGMENT =
  "If check_availability finds nothing open, offer the nearest open times it returned; if " +
  "none suit, offer the waitlist in one sentence. If they say yes, call join_waitlist with " +
  "their name, phone and preferred window (never take_message for this). Only say you'll text " +
  "them when an opening comes up if text messages are available.";

// ---------------------------------------------------------------------------
// CHANNELS-2 item 10 — multiple saved vehicles/pets/addresses on file
// (customers.metadata vehicles[]/pets[], customer_addresses). Reused by
// every vertical whose caller can have more than one of a recurring entity
// on file (auto/vehicles, vet/pets, restaurant+generic/addresses) AND by
// the text-agent's own persona (`_shared/text-agent/system-prompt.ts`) —
// authored once so the none/one/several rule and the identity-fallback
// (MASTER_SPEC §3.7) tie-in never drift between the two.
// ---------------------------------------------------------------------------

export const MULTI_ENTITY_FRAGMENT =
  "lookup_customer may return several saved vehicles/pets/addresses, most recent first. None: " +
  'collect fresh. One: confirm it ("still the <year make model from lookup_customer>?" / "is ' +
  'this for <pet name from lookup_customer>?" — placeholders, never real data). Several: ' +
  'offer them by their short label and ask which one ("your home or your work address?"); ' +
  "never read a full street address to an unverified caller. A new one is ADDED, never a " +
  "replacement, and becomes the default only if the caller says so.";

/** Every general-purpose fragment above, concatenated for convenient embedding into a `system_prompt`. */
export const QUALITY_AND_COLLECTION_FRAGMENT = [
  CONVERSATION_PACE_FRAGMENT,
  CURRENT_DATE_FRAGMENT,
  SILENCE_HANDLING_FRAGMENT,
  GIVE_UP_LADDER_FRAGMENT,
  ESCALATION_TRIGGERS_FRAGMENT,
  WARM_TRANSFER_FRAGMENT,
  LOW_CONFIDENCE_FIELD_FRAGMENT,
  DIGIT_BY_DIGIT_READBACK_FRAGMENT,
].join("\n\n");
