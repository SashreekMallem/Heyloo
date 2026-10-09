import { describe, expect, it } from "vitest";
import { buildTicketHtml, escapeHtml, TICKET_MARKER_ATTR } from "./ticket";
import type { LiveOrder } from "./types";

const ORDER: LiveOrder = {
  id: "8c1e2f4a-0000-4000-8000-00000000ab12",
  createdAt: "2026-10-09T23:05:00.000Z",
  status: "received",
  fulfillmentType: "delivery",
  customerName: "Priya Natarajan",
  customerPhone: "+15125551000",
  items: [
    { name: "Margherita pizza", qty: 2, unitPriceCents: 1450, modifiers: ["Extra basil"] },
    { name: "House salad", qty: 1, unitPriceCents: null, modifiers: [] },
  ],
  allergies: ["peanuts", "shellfish"],
  specialInstructions: "Ring twice",
  deliveryAddress: "142 Riverside Dr, Austin, TX 78701",
  addressVerification: "in_range",
  subtotalCents: 2900,
  taxCents: 239,
  tipCents: 500,
  deliveryFeeCents: 499,
  totalCents: 4138,
};

const OPTIONS = {
  businessName: "Golden Fork Bistro",
  timeZone: "America/Chicago",
  printedAt: new Date("2026-10-09T23:06:00.000Z"),
};

/** Text content of the ticket, as a printer would show it. */
function ticketText(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}

describe("escapeHtml (LIVE-1)", () => {
  it("escapes every HTML-significant character", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });
});

describe("buildTicketHtml (LIVE-1)", () => {
  it("is a full 80 mm document with the ticket marker and no scripts", () => {
    const html = buildTicketHtml(ORDER, OPTIONS);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("@page { size: 80mm auto; margin: 0; }");
    expect(html).toContain("max-width: 80mm");
    expect(html).toContain(`${TICKET_MARKER_ATTR}="1"`);
    expect(html).not.toMatch(/<script/i);
  });

  it("shows business, order number, time in the tenant timezone, fulfillment and customer", () => {
    const text = ticketText(buildTicketHtml(ORDER, OPTIONS));
    expect(text).toContain("Golden Fork Bistro");
    expect(text).toContain("#00AB12");
    expect(text).toContain("Delivery");
    // 23:05 UTC is 6:05 PM in Chicago (CDT).
    expect(text).toContain("6:05 PM");
    expect(text).toContain("Priya Natarajan");
    expect(text).toContain("(512) 555-1000");
    expect(text).toContain("142 Riverside Dr, Austin, TX 78701");
    expect(text).not.toContain("ADDRESS NOT VERIFIED");
  });

  it("prints allergies in their own big box", () => {
    const html = buildTicketHtml(ORDER, OPTIONS);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const box = doc.querySelector(".allergy");
    expect(box?.textContent).toBe("Allergy: peanuts, shellfish");
    expect(html).toMatch(/\.allergy \{[^}]*font-size: 18px[^}]*font-weight: 700/);
  });

  it("omits the allergy box when there are none", () => {
    const html = buildTicketHtml({ ...ORDER, allergies: [] }, OPTIONS);
    expect(new DOMParser().parseFromString(html, "text/html").querySelector(".allergy")).toBeNull();
  });

  it("lists items with quantity, modifiers and line totals, then the money in cents-exact dollars", () => {
    const text = ticketText(buildTicketHtml(ORDER, OPTIONS));
    expect(text).toContain("2× Margherita pizza");
    expect(text).toContain("$29.00");
    expect(text).toContain("- Extra basil");
    expect(text).toContain("1× House salad");
    expect(text).toContain("Notes: Ring twice");
    expect(text).toContain("Subtotal$29.00");
    expect(text).toContain("Tax$2.39");
    expect(text).toContain("Delivery fee$4.99");
    expect(text).toContain("Tip$5.00");
    expect(text).toContain("Total$41.38");
  });

  it("flags an unverified delivery address", () => {
    const text = ticketText(
      buildTicketHtml({ ...ORDER, addressVerification: "not_found" }, OPTIONS),
    );
    expect(text).toContain("ADDRESS NOT VERIFIED");
  });

  it("escapes caller- and AI-provided text everywhere it appears", () => {
    const evil = `<img src=x onerror="alert(1)">`;
    const html = buildTicketHtml(
      {
        ...ORDER,
        customerName: evil,
        items: [{ name: evil, qty: 1, unitPriceCents: 100, modifiers: [evil] }],
        allergies: [evil],
        specialInstructions: `</div><script>alert(2)</script>`,
        deliveryAddress: evil,
      },
      { ...OPTIONS, businessName: `<b>Joe's & Co</b>` },
    );
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("<b>Joe");
    expect(html).toContain("&lt;b&gt;Joe&#39;s &amp; Co&lt;/b&gt;");
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelectorAll("img, script")).toHaveLength(0);
    expect(doc.querySelector(".allergy")?.textContent).toBe(`Allergy: ${evil}`);
    expect(doc.body.textContent).toContain(`Notes: </div><script>alert(2)</script>`);
  });
});
