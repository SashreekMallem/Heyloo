import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Serves `packages/widget`'s LAZY voice-runtime bundle
 * (`dist/voice-runtime.global.js`, bundles `retell-client-js-sdk` — see
 * `packages/widget/src/voice-bridge.ts`'s docstring). Only ever requested
 * by `voice-bridge.ts`'s `loadVoiceRuntime()`, once a visitor opens Voice
 * mode — never on initial widget load. Same disk-read + content-hash-ETag
 * shape as `../widget.js/route.ts`; kept as a sibling file rather than
 * factored into a shared helper since there are only two of these and the
 * duplication is small and load-bearing on the docstring explaining each
 * file's OWN cache reasoning.
 */

const DIST_PATH = path.join(
  process.cwd(),
  "..",
  "..",
  "packages",
  "widget",
  "dist",
  "voice-runtime.global.js",
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
  if (!script) return new NextResponse(null, { status: 404 });

  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch === script.etag) {
    return new NextResponse(null, { status: 304, headers: { etag: script.etag } });
  }

  return new NextResponse(new Uint8Array(script.body), {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // This bundle is only ever fetched by our own widget.js, dynamically,
      // never linked directly by a tenant's page — a longer cache is safe
      // since a stale voice-runtime.js only matters for the brief window
      // between a redeploy and the next time someone opens Voice mode.
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      etag: script.etag,
      "x-widget-version": script.etag,
    },
  });
}
