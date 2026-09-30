import { describe, expect, it } from "vitest";
import { getLegalDoc } from "./legal";

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
    for (const name of ["Retell", "Supabase", "Stripe", "Vercel", "Resend"]) {
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
});
