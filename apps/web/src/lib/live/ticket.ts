import { formatCentsUSD } from "@heyloo/canonical-types";
import { formatPhoneDisplay } from "@heyloo/ui/lib/format-phone";
import {
  formatDateTimeInZone,
  formatTimeInZone,
  fulfillmentLabel,
  shortOrderNumber,
} from "./format";
import type { LiveOrder } from "./types";

/**
 * 80 mm kitchen ticket for one order (LIVE-1), as a complete standalone
 * HTML document printed from a hidden iframe (`print.ts`).
 *
 * Every value that came from a caller or the AI (names, items, modifiers,
 * allergies, notes, address) is HTML-escaped: the document is injected via
 * `srcdoc` / `document.write`, so unescaped text would be live markup in a
 * same-origin frame. No scripts, no external resources.
 *
 * `@page { size: 80mm auto }` is ignored by older iOS Safari (support from
 * 18.2), so the body is also capped at `max-width: 80mm`.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Marker the printer checks to confirm the frame really holds the ticket. */
export const TICKET_MARKER_ATTR = "data-heyloo-ticket";

const TICKET_CSS = `
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { width: 100%; max-width: 80mm; padding: 3mm 4mm 6mm; font: 13px/1.35 ui-monospace, Menlo, Consolas, "Courier New", monospace; }
h1 { font-size: 16px; margin: 0 0 2mm; text-align: center; }
.num { font-size: 26px; font-weight: 700; text-align: center; margin: 0; }
.kind { font-size: 18px; font-weight: 700; text-align: center; text-transform: uppercase; margin: 1mm 0; }
.meta { text-align: center; margin: 0 0 2mm; }
hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
.allergy { border: 3px solid #000; padding: 2mm; margin: 2mm 0; font-size: 18px; font-weight: 700; text-transform: uppercase; }
.notes { font-size: 15px; font-weight: 700; margin: 2mm 0; }
ul { list-style: none; margin: 0; padding: 0; }
li { margin: 0 0 1.5mm; }
.line { display: flex; justify-content: space-between; gap: 2mm; }
.item { font-size: 15px; font-weight: 700; }
.mod { padding-left: 4mm; }
.totals .line { font-size: 13px; }
.total { font-weight: 700; font-size: 15px; }
.foot { text-align: center; margin-top: 3mm; font-size: 11px; }
`;

function line(label: string, value: string, className = "line"): string {
  return `<div class="${className}"><span>${label}</span><span>${value}</span></div>`;
}

export function buildTicketHtml(
  order: LiveOrder,
  options: { businessName: string; timeZone: string; printedAt?: Date },
): string {
  const e = escapeHtml;
  const number = shortOrderNumber(order.id);
  const customer = [
    order.customerName ? e(order.customerName) : null,
    order.customerPhone ? e(formatPhoneDisplay(order.customerPhone)) : null,
  ].filter(Boolean);

  const items = order.items
    .map((item) => {
      const price =
        item.unitPriceCents !== null ? e(formatCentsUSD(item.unitPriceCents * item.qty)) : "";
      const mods = item.modifiers.map((m) => `<div class="mod">- ${e(m)}</div>`).join("");
      return `<li>${line(`${item.qty}&times; ${e(item.name)}`, price, "line item")}${mods}</li>`;
    })
    .join("");

  const parts: string[] = [
    `<h1>${e(options.businessName)}</h1>`,
    `<p class="num">${e(number)}</p>`,
    `<p class="kind">${e(fulfillmentLabel(order.fulfillmentType))}</p>`,
    `<p class="meta">${e(formatDateTimeInZone(order.createdAt, options.timeZone))}</p>`,
  ];
  if (customer.length > 0) parts.push(`<p class="meta">${customer.join(" &middot; ")}</p>`);
  if (order.fulfillmentType === "delivery" && order.deliveryAddress) {
    parts.push(`<p class="meta">${e(order.deliveryAddress)}</p>`);
    if (order.addressVerification && order.addressVerification !== "in_range") {
      parts.push(`<p class="meta"><strong>ADDRESS NOT VERIFIED</strong></p>`);
    }
  }
  if (order.allergies.length > 0) {
    parts.push(`<div class="allergy">Allergy: ${order.allergies.map(e).join(", ")}</div>`);
  }
  parts.push("<hr>", `<ul>${items}</ul>`);
  if (order.specialInstructions) {
    parts.push("<hr>", `<div class="notes">Notes: ${e(order.specialInstructions)}</div>`);
  }
  const totals = [line("Subtotal", e(formatCentsUSD(order.subtotalCents)))];
  if (order.taxCents > 0) totals.push(line("Tax", e(formatCentsUSD(order.taxCents))));
  if (order.deliveryFeeCents > 0) {
    totals.push(line("Delivery fee", e(formatCentsUSD(order.deliveryFeeCents))));
  }
  if (order.tipCents > 0) totals.push(line("Tip", e(formatCentsUSD(order.tipCents))));
  totals.push(line("Total", e(formatCentsUSD(order.totalCents)), "line total"));
  parts.push("<hr>", `<div class="totals">${totals.join("")}</div>`);
  parts.push(
    `<p class="foot">Printed ${e(formatTimeInZone(options.printedAt ?? new Date(), options.timeZone))}</p>`,
  );

  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>Order ${e(number)}</title>`,
    `<style>${TICKET_CSS}</style>`,
    `</head><body ${TICKET_MARKER_ATTR}="1">`,
    parts.join(""),
    "</body></html>",
  ].join("");
}
