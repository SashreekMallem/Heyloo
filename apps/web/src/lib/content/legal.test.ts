import { describe, expect, it } from "vitest";
import { fillEntity, getLegalDoc, getLegalEntity } from "./legal";

describe("legal documents (F-07)", () => {
  it.each(["terms", "privacy", "dpa"] as const)(
    "%s has no internal drafting note",
    async (slug) => {
      const doc = await getLegalDoc(slug);
      expect(doc.content).not.toMatch(/counsel/i);
      expect(doc.content).not.toMatch(/pending final/i);
      expect(doc.updated).not.toBe("");
    },
  );

  it("states the retention window the database actually applies (tenants.retention_days defaults to 30)", async () => {
    for (const slug of ["terms", "privacy", "dpa"] as const) {
      const doc = await getLegalDoc(slug);
      expect(doc.content).toContain("30 days");
      expect(doc.content).not.toContain("90 days");
    }
  });

  it("the privacy policy names the sub-processors the DPA refers to, and covers data-subject rights", async () => {
    const privacy = await getLegalDoc("privacy");
    for (const name of ["Retell", "OpenAI", "Supabase", "Stripe", "Vercel", "Microsoft"]) {
      expect(privacy.content).toContain(name);
    }
    expect(privacy.content).toMatch(/right to access, correct, export or delete/);
    const dpa = await getLegalDoc("dpa");
    expect(dpa.content).toContain("/legal/privacy");
  });

  it("keeps the AI and recording disclosure in the terms and privacy policy", async () => {
    for (const slug of ["terms", "privacy"] as const) {
      const doc = await getLegalDoc(slug);
      expect(doc.content).toMatch(/speaking with an AI|artificial intelligence/);
      expect(doc.content).toMatch(/recorded/);
    }
  });

  it("fills every business-detail placeholder from content/legal/entity.json", async () => {
    const entity = await getLegalEntity();
    for (const slug of ["terms", "privacy", "dpa"] as const) {
      const doc = await getLegalDoc(slug);
      expect(doc.content).not.toMatch(/\{\{/);
      expect(doc.content).toContain(entity["legal_name"]);
      expect(doc.content).toContain(entity["address"]);
    }
  });

  it("fails loudly on a placeholder that entity.json does not define", () => {
    expect(fillEntity("Hello {{legal_name}}", { legal_name: "Acme" })).toBe("Hello Acme");
    expect(() => fillEntity("{{no_such_key}}", {})).toThrow(/unknown placeholder/);
  });

  it("only promises the automatic deletion the product performs (recordings, not transcripts)", async () => {
    for (const slug of ["terms", "privacy", "dpa"] as const) {
      const doc = await getLegalDoc(slug);
      expect(doc.content).not.toMatch(/recordings and transcripts (are|is) (kept|deleted)/i);
      expect(doc.content).not.toMatch(/export[^.]*from the dashboard/i);
    }
  });
});
