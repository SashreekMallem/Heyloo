import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Serves `packages/widget`'s built main bundle (`dist/widget.global.js` —
 * see that package's `tsup.config.ts` for why it's named `.global.js`,
 * not `widget.js`, on disk) at the STABLE public URL
 * `https://app.heyloo.example/widget.js` that every tenant's Install-page
 * snippet embeds (`<script src=".../widget.js" data-key="...">`). The URL
 * itself never changes across deploys — a tenant's `<script>` tag is
 * pasted once — so this can't use an immutable/1-year cache the way a
 * content-hashed asset URL could; instead it's a short real cache
 * (browsers/CDNs re-check often) plus a content-hash ETag ("+ version" per
 * this route's ownership brief) so a redeploy that didn't actually change
 * the bundle still serves a cheap 304 instead of the full ~15KB payload.
 *
 * Reads the built file from disk on each cold start and caches it in
 * module scope for the life of that server instance — this package has no
 * runtime dependents inside `apps/web`'s own dependency graph (it's a
 * standalone browser bundle, never `import`ed), so Next's build-time
 * tracing can't discover it on its own; `next.config.ts`'s
 * `outputFileTracingIncludes` explicitly pins this exact path so a
 * production (standalone) build actually ships the file next to this
 * route's server output.
 */

const DIST_PATH = path.join(
  process.cwd(),
  "..",
  "..",
  "packages",
  "widget",
  "dist",
  "widget.global.js",
);

let cached: { body: Buffer; etag: string } | null = null;

async function loadScript(): Promise<{ body: Buffer; etag: string } | null> {
  if (cached) return cached;
  try {
    const body = await readFile(DIST_PATH);
    const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
    cached = { body, etag };
    return cached;
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const script = await loadScript();
  if (!script) {
    // The package hasn't been built into this deploy — fail as a normal
    // 404, never a 500 that could look like the whole app is down; the
    // widget simply won't render on a tenant's site until this is fixed,
    // which is the same "fail closed, never break the host page" posture
    // `packages/widget/src/index.ts` itself follows on a fetch failure.
    return new NextResponse(null, { status: 404 });
  }

  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch === script.etag) {
    return new NextResponse(null, { status: 304, headers: { etag: script.etag } });
  }

  return new NextResponse(new Uint8Array(script.body), {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300, stale-while-revalidate=86400",
      etag: script.etag,
      "x-widget-version": script.etag,
    },
  });
}
