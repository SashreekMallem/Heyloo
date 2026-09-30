import type { CARRIERS } from "@heyloo/canonical-types";

export type Carrier = (typeof CARRIERS)[number];
export const CARRIER_LABELS: Record<Carrier, string> = {
  att: "AT&T",
  verizon: "Verizon",
  tmobile: "T-Mobile",
  other_landline: "Other / landline",
};

export type ForwardingMode = "conditional" | "full";

export interface ForwardingCodeTemplate {
  label: string;
  /** `{number}` is replaced with the 10-digit national number (see `dialableNumber`). */
  code: string;
}

/**
 * Carrier dial codes. QA-1 F-2: AT&T used to copy Verizon's `*71`/`*73`, and
 * every code carried `+1` (carriers want the 10-digit number, not E.164).
 *
 * Sources (see docs/VERIFY.md, "QA-1 F-2"):
 * - Verizon: verizon.com/support/call-forwarding-faqs — `*72` all calls,
 *   `*71` unanswered, `*73` cancel, "10 digits ... area code always included".
 * - AT&T wireless is GSM: `*004*<number>*11#` conditional (busy/no answer/
 *   unreachable) and `##004#` cancel (3GPP TS 22.030 MMI; AT&T's own support
 *   article lists no codes, so this comes from carrier-partner guides and
 *   still needs a live confirmation). `*21*<number>#` / `##21#` is the
 *   standard unconditional form.
 * - T-Mobile is GSM: `**004*<number>#` conditional, `##004#` cancel.
 * - Landline: `*72<number>` on, `*73` off (NANP vertical service codes).
 */
export const CARRIER_CODES: Record<Carrier, Record<ForwardingMode, ForwardingCodeTemplate[]>> = {
  att: {
    conditional: [
      { label: "Forward when busy or unanswered", code: "*004*{number}*11#" },
      { label: "Cancel forwarding", code: "##004#" },
    ],
    full: [
      { label: "Forward all calls", code: "*21*{number}#" },
      { label: "Cancel forwarding", code: "##21#" },
    ],
  },
  verizon: {
    conditional: [
      { label: "Forward when unanswered", code: "*71{number}" },
      { label: "Cancel forwarding", code: "*73" },
    ],
    full: [
      { label: "Forward all calls", code: "*72{number}" },
      { label: "Cancel forwarding", code: "*73" },
    ],
  },
  tmobile: {
    conditional: [
      { label: "Forward when busy or unanswered", code: "**004*{number}#" },
      { label: "Cancel forwarding", code: "##004#" },
    ],
    full: [
      { label: "Forward all calls", code: "**21*{number}#" },
      { label: "Cancel forwarding", code: "##21#" },
    ],
  },
  other_landline: {
    // `*72` is unconditional on a landline; busy/no-answer codes differ per
    // carrier, so both modes say so honestly rather than mislabel it.
    conditional: [
      { label: "Forward all calls", code: "*72{number}" },
      { label: "Cancel forwarding", code: "*73" },
    ],
    full: [
      { label: "Forward all calls", code: "*72{number}" },
      { label: "Cancel forwarding", code: "*73" },
    ],
  },
};

/**
 * The number as a customer dials it: a US/Canada `+1XXXXXXXXXX` becomes the
 * 10-digit `XXXXXXXXXX`; any other E.164 number keeps its international form.
 */
export function dialableNumber(e164: string): string {
  const match = /^\+1(\d{10})$/.exec(e164.trim());
  return match?.[1] ?? e164.trim();
}
