/**
 * The business types a visitor can pick for the live demo (DEMO-2), in the
 * order the selector shows them. Plain data, no imports, because the home
 * page's initial chunk carries it. `id` is exactly what `api-demo-agent`
 * accepts as `vertical` (its `DEMO_VERTICALS` allowlist in
 * `supabase/functions/_shared/schemas/demo-agent.ts`); `/api/demo/instant`
 * rejects anything else before it reaches the edge function.
 */
export const DEMO_VERTICAL_IDS = [
  "auto",
  "dental",
  "vet",
  "legal",
  "real_estate",
  "motel",
  "restaurant",
  "generic",
] as const;

export type DemoVerticalId = (typeof DEMO_VERTICAL_IDS)[number];

export const DEFAULT_DEMO_VERTICAL: DemoVerticalId = "auto";

const LABELS: Record<DemoVerticalId, string> = {
  auto: "Auto repair",
  dental: "Dental",
  vet: "Veterinary",
  legal: "Legal",
  real_estate: "Real estate",
  motel: "Motel",
  restaurant: "Restaurant",
  generic: "Local services",
};

export const DEMO_VERTICALS: readonly { id: DemoVerticalId; label: string }[] =
  DEMO_VERTICAL_IDS.map((id) => ({ id, label: LABELS[id] }));

export function isDemoVertical(value: unknown): value is DemoVerticalId {
  return typeof value === "string" && (DEMO_VERTICAL_IDS as readonly string[]).includes(value);
}

export function demoVerticalLabel(id: DemoVerticalId): string {
  return LABELS[id];
}
