import { describe, expect, it } from "vitest";
import { TEMPLATE_DEFINITIONS } from "../registry.js";
import {
  CONSENT_ASK_FRAGMENT,
  LOW_CONFIDENCE_FIELD_FRAGMENT,
  WAITLIST_OFFER_FRAGMENT,
} from "../shared/fragments.js";
import { findTextPromises, findUngatedTextInstructions, splitSentences } from "./texting-lint.js";

describe("texting lint — the checker itself discriminates", () => {
  it("flags authored instructions that promise or trigger a text unconditionally", () => {
    for (const bad of [
      "Then create the booking and send the SMS confirmation.",
      "Offer to text the caller a secure link so they can enter it themselves.",
      "Tell them someone will text you the moment something opens up.",
      "Always send a payment link; always send the SMS confirmation.",
      "They'll be texted automatically if a slot opens up.",
      "Send a text confirmation for a booking or order.",
      "A secure link for insurance/DOB will follow separately.",
    ]) {
      expect(findUngatedTextInstructions(bad), bad).toEqual([bad]);
    }
  });

  it("accepts the same instructions once gated on availability, or as prohibitions", () => {
    for (const good of [
      "Then create the booking and, if text messages are available, send the SMS confirmation.",
      "Only if text messages are available, offer to text them a secure link.",
      "Never offer to text the caller; do not call send_sms_confirmation.",
      "Text messages are NOT available: never say you will send a text confirmation.",
      "Queue a text confirmation only when text messages are available for this business.",
    ]) {
      expect(findUngatedTextInstructions(good), good).toEqual([]);
    }
  });

  it("ignores sentences that do not concern texting at all", () => {
    expect(
      findUngatedTextInstructions(
        "Read back the day and time. Ask for the caller's name. Take a message if nobody is free.",
      ),
    ).toEqual([]);
  });

  it("finds promises in English and Spanish, but not prohibitions or denials", () => {
    for (const promise of [
      "Perfect, I'll text you a confirmation right now.",
      "I'm texting you the details.",
      "We will send you a message with the address.",
      "You'll get a text in a moment.",
      "A confirmation is on its way to your phone.",
      "I've sent you a text with the link.",
      "Listo, te envío un mensaje con la confirmación.",
      "Le mando un mensaje de texto ahora mismo.",
      "Te enviaré un SMS.",
    ]) {
      expect(findTextPromises(promise), promise).toEqual([promise]);
    }
    for (const fine of [
      "Texting is not available for this business, so NO text was sent and none will be.",
      "Do not say or imply that you are texting or sending a message.",
      "Do not say or imply that a link is on its way.",
      "Never tell the caller a text was sent unless queued is true.",
      "Confirm out loud instead and read back the day, time and key details.",
      "Someone from the team will follow up.",
      "Su cita está confirmada para el martes a las 10.",
    ]) {
      expect(findTextPromises(fine), fine).toEqual([]);
    }
  });

  it("splits sentences without cutting at abbreviations inside quotes or parentheses", () => {
    expect(splitSentences('Ask: "Is it okay?" (Only if available.) Then wait.')).toEqual([
      'Ask: "Is it okay?" (Only if available.)',
      "Then wait.",
    ]);
  });
});

describe("MSG-3: every shipped template is safe with texting OFF", () => {
  it("the shared fragments that used to promise a text are gated", () => {
    for (const fragment of [
      LOW_CONFIDENCE_FIELD_FRAGMENT,
      CONSENT_ASK_FRAGMENT,
      WAITLIST_OFFER_FRAGMENT,
    ]) {
      expect(findUngatedTextInstructions(fragment)).toEqual([]);
    }
    // The consent ask keeps the words the consent structural test looks for,
    // and tells the model what to ask when it cannot text.
    expect(CONSENT_ASK_FRAGMENT.toLowerCase()).toContain("is it okay to text or call you");
    expect(CONSENT_ASK_FRAGMENT).toContain("Is it okay to call you about this?");
    expect(CONSENT_ASK_FRAGMENT).toContain("pass sms as false");
  });

  for (const { key, template } of TEMPLATE_DEFINITIONS) {
    it(`${key}: no system prompt sentence, state fragment or tool description promises a text unconditionally`, () => {
      const texts: Array<[string, string]> = [
        ["system_prompt", template.system_prompt ?? ""],
        ...template.states.map((s): [string, string] => [`state:${s.id}`, s.prompt_fragment]),
        ...template.tools.map((t): [string, string] => [`tool:${t.name}`, t.description]),
      ];
      const findings = texts.flatMap(([where, text]) =>
        findUngatedTextInstructions(text).map((sentence) => `${where}: ${sentence}`),
      );
      expect(findings).toEqual([]);
    });
  }

  it("a template that can text names the availability rule where it offers the tool", () => {
    for (const { key, template } of TEMPLATE_DEFINITIONS) {
      const tool = template.tools.find((t) => t.name === "send_sms_confirmation");
      if (!tool) continue;
      expect(tool.description, key).toMatch(/only when text messages are available/);
      expect(tool.description, key).toMatch(/sms_unavailable/);
    }
  });
});
