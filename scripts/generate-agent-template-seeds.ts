/**
 * Regenerates `supabase/functions/_shared/agent-template-seeds.ts` (the
 * copy of the templates that edge functions seed `agent_templates` from)
 * out of `packages/templates`' build artifact, so the two can no longer
 * drift apart. They did: the seed copy was hand-edited for months while
 * the source fell behind, and running `sync-agent-templates.ts` then wrote
 * the older source over the live templates (docs/BUILD_NOTES.md,
 * LAUNCH-restaurant-menu). `packages/templates/src/seed-drift.test.ts`
 * fails whenever the two differ.
 *
 * Edit `packages/templates/src`, then:
 *
 *   pnpm --filter @heyloo/templates build
 *   node --experimental-strip-types scripts/generate-agent-template-seeds.ts
 *
 * Only the `AGENT_TEMPLATE_SEEDS` object is replaced; the file's header and
 * exports above it are kept as they are. The output is formatted with
 * biome afterwards.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ARTIFACT = `${ROOT}packages/templates/dist/templates.build.json`;
const SEEDS = `${ROOT}supabase/functions/_shared/agent-template-seeds.ts`;
const OBJECT_START = "export const AGENT_TEMPLATE_SEEDS: Record<Vertical, AgentTemplateSeed> = {";

// Registry keys that differ from the backend's `Vertical` names.
const VERTICAL_FOR_KEY: Record<string, string> = { auto_repair: "auto" };

interface ArtifactEntry {
  key: string;
  name: string;
  template: Record<string, unknown>;
}

const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8")) as { templates: ArtifactEntry[] };
const current = readFileSync(SEEDS, "utf8");
const start = current.indexOf(OBJECT_START);
if (start < 0) throw new Error(`${SEEDS}: AGENT_TEMPLATE_SEEDS declaration not found`);

const entries = artifact.templates.map((entry) => {
  // The table has its own `vertical` column; the compiled content never carried it.
  const { vertical: _vertical, ...content } = entry.template;
  const vertical = VERTICAL_FOR_KEY[entry.key] ?? entry.key;
  return (
    `  ${vertical}: {\n` +
    `    name: ${JSON.stringify(entry.name)},\n` +
    `    content: ${JSON.stringify(content, null, 2)} as unknown as CompilerAgentTemplate,\n` +
    "  },\n"
  );
});

writeFileSync(SEEDS, `${current.slice(0, start)}${OBJECT_START}\n${entries.join("")}};\n`);
execFileSync("pnpm", ["exec", "biome", "format", "--write", SEEDS], {
  cwd: ROOT,
  stdio: "inherit",
});
console.log(`wrote ${entries.length} templates to ${SEEDS}`);
