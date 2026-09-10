import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIEW_ROUTES } from "./routes";

// `import.meta.dirname` here is `apps/web/src/lib/preview` — 5 segments
// below the repo root (apps/web/src/lib/preview).
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const APPS_WEB_SRC = path.resolve(import.meta.dirname, "../..");

/**
 * Every entry in `PREVIEW_ROUTES` promises a mirror file exists under
 * `(preview)/preview/**` that re-exports the real page named in `source`
 * (docs/DESIGN_SYSTEM.md §UI Preview Mode). That promise silently rots the
 * moment a real page moves/renames and the mirror generator isn't re-run —
 * the route still LOOKS registered (shows up on `/preview`), but resolves
 * to nothing at request time.
 *
 * This deliberately does NOT `import()` the mirror/real modules — several
 * real pages construct a Supabase client at module scope
 * (`src/lib/supabase/browser.ts`), which throws outside a real Next.js
 * runtime with real env vars configured, and `next-intl`'s navigation
 * helpers don't resolve cleanly under plain Vitest/Node either. Reading
 * `source` back off `require.resolve`-style filesystem checks and
 * confirming the mirror's re-export line names that exact same path is
 * the right altitude for this test — it catches the actual failure mode
 * (a stale/renamed mirror, or a route registered with no mirror at all)
 * without needing a full Next.js render environment.
 */
/**
 * Mirrors that deliberately redirect to a sibling preview route instead of
 * re-exporting their real page's default export verbatim, because the real
 * page has no content of its own — it's just a `redirect(...)` (round-3
 * tenant design review, blocker: re-exporting such a page bounces a
 * preview viewer out of `/preview/**` into the real auth-gated route). See
 * `(preview)/preview/dashboard/agent/page.tsx`'s own comment.
 */
const REDIRECT_ONLY_MIRRORS = new Set(["/preview/dashboard/agent"]);

describe("PREVIEW_ROUTES — every registered route resolves a mirror component", () => {
  it("has a non-trivial number of registered routes", () => {
    expect(PREVIEW_ROUTES.length).toBeGreaterThan(50);
  });

  it("has no duplicate urls or hrefs", () => {
    const urls = PREVIEW_ROUTES.map((r) => r.url);
    const hrefs = PREVIEW_ROUTES.map((r) => r.href);
    expect(new Set(urls).size).toBe(urls.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it.each(PREVIEW_ROUTES.filter((r) => REDIRECT_ONLY_MIRRORS.has(r.url)))(
    "$url is a redirect-only mirror that stays inside /preview/**, and its declared source ($source) still exists",
    (route) => {
      const mirrorFsPath = path.join(
        APPS_WEB_SRC,
        "app",
        "[locale]",
        "(preview)",
        route.url,
        "page.tsx",
      );
      expect(fs.existsSync(mirrorFsPath), `no mirror file for ${route.url}`).toBe(true);
      const mirrorContent = fs.readFileSync(mirrorFsPath, "utf8");
      expect(
        /redirect\(\s*"\/preview\//.test(mirrorContent),
        `${mirrorFsPath} is registered as a redirect-only mirror but doesn't redirect to a /preview/** path:\n${mirrorContent}`,
      ).toBe(true);

      // The declared `source` must still exist and still be redirect-only
      // itself — if the real page ever grows real content, this mirror is
      // stale and should go back to re-exporting it instead.
      const sourceFsPath = path.join(REPO_ROOT, route.source);
      expect(
        fs.existsSync(sourceFsPath),
        `${route.url}'s declared source doesn't exist: ${route.source}`,
      ).toBe(true);
      const sourceContent = fs.readFileSync(sourceFsPath, "utf8");
      expect(
        /redirect\(/.test(sourceContent),
        `${route.source} no longer looks redirect-only — ${route.url}'s mirror should re-export it directly instead of redirecting`,
      ).toBe(true);
    },
  );

  it.each(PREVIEW_ROUTES.filter((r) => !REDIRECT_ONLY_MIRRORS.has(r.url)))(
    "$url has a mirror page.tsx that re-exports its declared source ($source)",
    (route) => {
      // Mirrors live at `apps/web/src/app/[locale]/(preview)${url}/page.tsx`
      // — `url` already starts with `/preview`, matching the on-disk
      // `preview/**` directory under the `(preview)` route group.
      const mirrorFsPath = path.join(
        APPS_WEB_SRC,
        "app",
        "[locale]",
        "(preview)",
        route.url,
        "page.tsx",
      );
      expect(
        fs.existsSync(mirrorFsPath),
        `no mirror file for ${route.url} — expected ${mirrorFsPath}`,
      ).toBe(true);

      const mirrorContent = fs.readFileSync(mirrorFsPath, "utf8");

      // The declared `source` (e.g.
      // "apps/web/src/app/[locale]/(tenant)/dashboard/calls/[id]/page.tsx")
      // must exist on disk, ...
      const sourceFsPath = path.join(REPO_ROOT, route.source);
      expect(
        fs.existsSync(sourceFsPath),
        `${route.url}'s declared source doesn't exist: ${route.source}`,
      ).toBe(true);

      // ...and the mirror must actually re-export a default FROM that same
      // module (not some other, stale path) — this is what makes the
      // route resolve to a real component instead of an empty module.
      const expectedSpecifier = `@/${route.source.replace(/^apps\/web\/src\//, "").replace(/\.tsx$/, "")}`;
      expect(
        mirrorContent.includes(`from "${expectedSpecifier}"`),
        `${mirrorFsPath} doesn't re-export from ${expectedSpecifier} (source: ${route.source}); got:\n${mirrorContent}`,
      ).toBe(true);
      expect(
        /export\s*\{\s*default\s*[,}]/.test(mirrorContent) ||
          /export\s+default\s/.test(mirrorContent),
        `${mirrorFsPath} doesn't appear to export a default component`,
      ).toBe(true);
    },
  );
});
