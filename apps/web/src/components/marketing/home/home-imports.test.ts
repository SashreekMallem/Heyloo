import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards for the home page's loading model: the motion libraries and the 3D
 * engine may only ever reach the browser through dynamic `import()`s that run
 * after first paint. A static import anywhere else would put gsap, Lenis or
 * three.js into a route's initial JS and break the perf budget
 * (scripts/site-perf/budgets.ts).
 */
const SRC = path.resolve(import.meta.dirname, "../../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** Value (non-type) static imports of `from "<spec>"`, matched by a prefix of the specifier. */
function staticImports(file: string, prefixes: string[]): string[] {
  const text = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const match of text.matchAll(/^import\s([^;'"]*)from\s+["']([^"']+)["']/gm)) {
    const [, clause, spec] = match;
    if (clause?.startsWith("type ") || !spec) continue;
    if (prefixes.some((p) => spec === p || spec.startsWith(`${p}/`))) found.push(spec);
  }
  return found;
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");
const files = sourceFiles(SRC);

describe("motion libraries stay behind dynamic imports", () => {
  it("only runtime/start.ts (dynamically imported) names gsap or lenis, and never with a static import", () => {
    const offenders = files.filter((f) => staticImports(f, ["gsap", "lenis"]).length > 0).map(rel);
    expect(offenders).toEqual([]);
    const start = readFileSync(
      path.join(SRC, "components/marketing/home/runtime/start.ts"),
      "utf8",
    );
    for (const spec of ["gsap", "gsap/ScrollTrigger", "gsap/SplitText", "lenis"]) {
      expect(start).toContain(`import("${spec}")`);
    }
  });

  it("only scene/ statically imports three", () => {
    const offenders = files
      .filter((f) => staticImports(f, ["three"]).length > 0)
      .map(rel)
      .filter((f) => !f.startsWith("components/marketing/home/scene/"));
    expect(offenders).toEqual([]);
  });

  it("reaches the scene module only through a dynamic import (type imports are erased)", () => {
    const offenders = files
      .filter((f) => !rel(f).startsWith("components/marketing/home/scene/"))
      .filter((f) => staticImports(f, ["../scene/scene", "./scene/scene"]).length > 0)
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("keeps the route's initial chunk free of the runtime: home-motion.tsx loads it lazily", () => {
    const motion = readFileSync(
      path.join(SRC, "components/marketing/home/home-motion.tsx"),
      "utf8",
    );
    expect(motion).toContain('import("./runtime/start")');
    expect(motion).not.toMatch(/from\s+["']\.\/runtime\/(start|page-runtime)["']/);
    expect(motion).not.toMatch(/from\s+["'](\.\.\/)?scene/);
  });

  it("keeps the Retell web SDK behind a dynamic import inside components/demo", () => {
    const offenders = files.filter((f) => staticImports(f, ["retell-client-js-sdk"]).length > 0);
    expect(offenders.map(rel)).toEqual([]);
    const hook = readFileSync(path.join(SRC, "components/demo/use-demo-call.ts"), "utf8");
    expect(hook).toContain('import("retell-client-js-sdk")');
  });
});
