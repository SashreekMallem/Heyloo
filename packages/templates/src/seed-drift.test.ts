import { describe, expect, it } from "vitest";
import { TEMPLATE_DEFINITIONS } from "./index.js";

// The edge functions seed `agent_templates` from their own copy of these
// templates (`supabase/functions/_shared/agent-template-seeds.ts`). That copy
// is generated from this package by `scripts/generate-agent-template-seeds.ts`;
// this fails when someone edits one side without regenerating the other.
// Imported by computed URL: the file sits outside this package's tsconfig.
const SEEDS_URL = new URL(
  "../../../supabase/functions/_shared/agent-template-seeds.ts",
  import.meta.url,
).href;
const VERTICAL_FOR_KEY: Record<string, string> = { auto_repair: "auto" };

describe("edge-function seed copy matches the template source", () => {
  it.each(TEMPLATE_DEFINITIONS.map((def) => [def.key, def] as const))("%s", async (key, def) => {
    const { AGENT_TEMPLATE_SEEDS } = (await import(SEEDS_URL)) as {
      AGENT_TEMPLATE_SEEDS: Record<string, { name: string; content: unknown }>;
    };
    const seed = AGENT_TEMPLATE_SEEDS[VERTICAL_FOR_KEY[key] ?? key];
    const { vertical: _vertical, ...content } = def.template;
    expect(seed?.name).toBe(def.name);
    // JSON round-trip: the seed copy is what the build artifact serializes.
    expect(seed?.content).toEqual(JSON.parse(JSON.stringify(content)));
  });
});
