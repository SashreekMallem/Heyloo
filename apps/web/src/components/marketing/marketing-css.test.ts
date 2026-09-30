import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The marketing styles are plain, unlayered CSS (they beat Tailwind's layered
 * utilities), so a rule that leaks out of the `.mk` shell would restyle the
 * dashboard, the admin cockpit and every ui component. This guard reads both
 * files and fails on any selector that is not scoped to the shell, and on the
 * generic element resets that would override Tailwind utilities inside it.
 */
const DIR = import.meta.dirname;

function selectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  const preludeStack: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      const prelude = text.slice(start, i).trim();
      preludeStack.push(prelude);
      if (!prelude.startsWith("@")) out.push(...prelude.split(",").map((s) => s.trim()));
      depth++;
      start = i + 1;
    } else if (ch === "}") {
      depth--;
      preludeStack.pop();
      start = i + 1;
    } else if (ch === ";" && depth >= 0) {
      start = i + 1;
    }
  }
  return out.filter(Boolean);
}

// `.lenis*` are the classes Lenis itself puts on <html> while smooth scroll runs.
const ALLOWED_START = [
  /^\.lenis(\.|\s|$)/,
  /^\.mk(\s|\.|:|\[|,|$)/,
  /^html\.[\w-]/,
  /^:root(\[|:)/,
];

describe.each(["marketing.css", "home/home.css"])("%s", (file) => {
  const css = readFileSync(path.join(DIR, file), "utf8");
  const list = selectors(css);

  it("has rules", () => {
    expect(list.length).toBeGreaterThan(20);
  });

  it("scopes every selector to the .mk shell (or an html state class, or :root with .mk)", () => {
    const leaks = list.filter((sel) => !ALLOWED_START.some((re) => re.test(sel)));
    expect(leaks).toEqual([]);
  });

  it("never resets bare elements the way Tailwind's preflight already does", () => {
    const resets = list.filter((sel) =>
      /^\.mk\s+(p|h1|h2|h3|ul|ol|dl|dd|figure|blockquote|a|button|input)(\s|,|$)/.test(sel),
    );
    expect(resets).toEqual([]);
  });

  it("keeps html state selectors inside the shell", () => {
    const bare = list.filter(
      (sel) => /^html\.[\w.-]+\s/.test(sel) && !/\s\.mk(\s|$|\.|:)/.test(sel),
    );
    // the only allowed exceptions are Lenis' own classes
    expect(bare.filter((sel) => !sel.startsWith("html.lenis"))).toEqual([]);
  });
});

describe("tokens", () => {
  const css = readFileSync(path.join(DIR, "marketing.css"), "utf8");

  it("defaults to the dark palette and mirrors light on system preference and data-theme", () => {
    expect(css).toContain("--ground: oklch(0.16 0.006 265)");
    expect(css).toMatch(/prefers-color-scheme:\s*light/);
    expect(css).toContain(':root[data-theme="light"] .mk');
    expect(css).toContain(':root:not([data-theme="dark"]) .mk');
  });

  it("remaps the app's semantic colour tokens so the kept pages wear the new palette", () => {
    for (const token of ["--background", "--foreground", "--card", "--border", "--primary"]) {
      expect(css).toContain(`${token}: `);
    }
  });

  it("re-binds the primary utilities inside the shell so bg-primary follows the remap (QA-1 F-18)", () => {
    // The theme's `--color-primary: var(--primary)` is resolved on :root, so
    // remapping `--primary` alone left signup/demo/intake buttons orange next
    // to the near-black header CTA. The trio must be declared in a `.mk` block.
    const shellBlocks = css
      .split(/\.mk\s*\{/)
      .slice(1)
      .map((block) => block.slice(0, block.indexOf("}")));
    for (const name of ["primary", "primary-hover", "primary-foreground"]) {
      expect(shellBlocks.some((block) => block.includes(`--color-${name}: var(--${name})`))).toBe(
        true,
      );
    }
    // ...and stays the same token the header's .btn-p uses (ink on ground).
    expect(css).toContain("--primary: var(--ink)");
    expect(css).toContain("--primary-foreground: var(--ground)");
  });
});
