import { z } from "zod";
import { zVertical } from "../vertical.js";

/** `/cockpit/config-lab` — non-destructive margin what-if simulation (FRONTEND_SPEC.md §7.1.5). */
export const configLabScenarioSchema = z.object({
  name: z.string().trim().min(1, "Scenario name is required").max(200),
  vertical: zVertical,
  llm_tier: z.string().min(1),
  voice_tier: z.string().min(1),
  assumed_volume: z.number().int().nonnegative(),
});

export type ConfigLabScenario = z.infer<typeof configLabScenarioSchema>;
