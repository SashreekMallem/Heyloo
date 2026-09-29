import { describe, expect, it } from "vitest";
import { openingLinePreview } from "./greeting";

describe("openingLinePreview", () => {
  it("renders the verbatim English disclosure opening", () => {
    expect(
      openingLinePreview({ businessName: "Riverside Auto", assistantName: "Ava", language: "en" }),
    ).toBe(
      "Thanks for calling Riverside Auto. This is Ava, their AI assistant — this call may be recorded. How can I help you today?",
    );
  });

  it("uses the language-matched default assistant name and the Spanish literal", () => {
    expect(
      openingLinePreview({ businessName: "Anyservice", assistantName: " ", language: "es" }),
    ).toBe(
      "Gracias por llamar a Anyservice. Le atiende el asistente virtual, su asistente de inteligencia artificial; esta llamada puede ser grabada. ¿En qué puedo ayudarle hoy?",
    );
  });

  it("always includes the AI + recording disclosure", () => {
    const line = openingLinePreview({ businessName: "", assistantName: "", language: "fr" });
    expect(line).toContain("AI assistant");
    expect(line).toContain("this call may be recorded");
  });
});
