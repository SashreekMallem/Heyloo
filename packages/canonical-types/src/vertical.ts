/**
 * The 8 verticals the platform serves (SYSTEM_DESIGN §1 price card, §3.8 avg
 * transaction values, MASTER_SPEC §3.5 per-vertical config keys). `generic`
 * is the fallback vertical for any business that doesn't fit the other 7.
 */

import { z } from "zod";

export const VERTICALS = [
  "auto",
  "vet",
  "legal",
  "dental",
  "real_estate",
  "motel",
  "restaurant",
  "generic",
] as const;

export type Vertical = (typeof VERTICALS)[number];

export const zVertical = z.enum(VERTICALS);
