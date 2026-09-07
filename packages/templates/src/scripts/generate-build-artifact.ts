/**
 * Generates the versioned JSON build artifact a seed script / the
 * provisioning saga can consume without depending on this package's
 * TypeScript source directly (BUILD task item 4). Run as a post-build step
 * (`package.json`'s `build` script) against the COMPILED `dist/` output, so
 * this only ever runs against exactly what `@heyloo/templates` actually
 * exports.
 *
 * Every template is re-validated against the canonical `zAgentTemplate`
 * schema before being written — the artifact should never contain content
 * that wouldn't itself pass the same Zod gate a real `agent_templates`
 * insert would apply (BACKEND_SPEC §1.3).
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { zAgentTemplate } from "@heyloo/canonical-types";
import { TEMPLATE_DEFINITIONS, TEMPLATES_PACKAGE_VERSION } from "../index.js";

const OUTPUT_PATH = fileURLToPath(new URL("../templates.build.json", import.meta.url));

interface BuildArtifact {
  package_version: string;
  generated_at: string;
  templates: {
    key: string;
    name: string;
    version: number;
    template: unknown;
  }[];
}

async function main(): Promise<void> {
  const templates = TEMPLATE_DEFINITIONS.map((def) => {
    // Throws (failing the build) if any registered template doesn't validate —
    // this artifact must never ship content that wouldn't pass the same gate
    // a real `agent_templates` insert would apply.
    const validated = zAgentTemplate.parse(def.template);
    return { key: def.key, name: def.name, version: def.version, template: validated };
  });

  const artifact: BuildArtifact = {
    package_version: TEMPLATES_PACKAGE_VERSION,
    generated_at: new Date().toISOString(),
    templates,
  };

  await writeFile(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(`wrote ${templates.length} templates to ${OUTPUT_PATH}`);
}

await main();
