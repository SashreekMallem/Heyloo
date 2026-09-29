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

  it("defaults a blank assistant name to Ava in Spanish and uses the Spanish literal", () => {
    expect(
      openingLinePreview({ businessName: "Anyservice", assistantName: " ", language: "es" }),
    ).toBe(
      "Gracias por llamar a Anyservice. Le atiende Ava, su asistente de inteligencia artificial; esta llamada puede ser grabada. ¿En qué puedo ayudarle hoy?",
    );
  });

  it("never renders the AI-assistant-twice bug when the name is unset (en + es)", () => {
    const en = openingLinePreview({
      businessName: "Riverside Auto",
      assistantName: "",
      language: "en",
    });
    expect(en).toContain("This is Ava, their AI assistant");
    expect(en).not.toContain("AI assistant, their AI assistant");
    const es = openingLinePreview({
      businessName: "Riverside Auto",
      assistantName: "  ",
      language: "es",
    });
    expect(es).toContain("Le atiende Ava, su asistente de inteligencia artificial");
    expect(es).not.toContain("asistente virtual, su asistente");
  });

  it("always includes the AI + recording disclosure", () => {
    const line = openingLinePreview({ businessName: "", assistantName: "", language: "fr" });
    expect(line).toContain("AI assistant");
    expect(line).toContain("this call may be recorded");
  });
});
