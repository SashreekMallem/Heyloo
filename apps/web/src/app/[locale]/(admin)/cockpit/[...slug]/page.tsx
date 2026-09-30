import { notFound } from "next/navigation";

/**
 * Catch-all for unknown `/cockpit/*` paths (QA-1 COCKPIT-F22). An unmatched
 * URL never reaches a route group's `not-found.tsx` on its own — Next falls
 * through to its bare default 404, outside the cockpit shell. Matching it
 * here and calling `notFound()` renders `../not-found.tsx` inside the shell.
 * Every real cockpit route is more specific, so this only ever sees misses.
 */
export default function CockpitUnknownPage(): never {
  notFound();
}
