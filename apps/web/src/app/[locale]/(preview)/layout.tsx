// Side-effect import MUST be first: installs the preview `fetch` mock on
// the server before any nested layout/page below evaluates (see
// apps/web/src/lib/preview/install-server.ts and
// apps/web/src/lib/preview/README.md).
import "@/lib/preview/install-server";

import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isPreviewModeEnabled } from "@/lib/preview/guard";
import { PreviewClientBootstrap } from "@/lib/preview/preview-client-bootstrap";

/**
 * Root layout for the entire `/preview/**` route group — runtime guard
 * (docs/DESIGN_SYSTEM.md §UI Preview Mode). This is independent of the
 * build-time module aliasing in `next.config.ts`: even a build that
 * somehow shipped with `UI_PREVIEW_MODE=1` baked in 404s every request
 * here once `NODE_ENV === "production"`.
 */
export default function PreviewLayout({ children }: { children: ReactNode }) {
  if (!isPreviewModeEnabled()) notFound();

  return (
    <>
      <PreviewClientBootstrap />
      <div className="sticky top-0 z-(--z-banner) flex items-center justify-between gap-3 border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-small text-warning">
        <span className="font-medium">UI Preview Mode — fixture data, no real auth or network</span>
        <a href="/preview" className="underline underline-offset-2">
          All preview routes
        </a>
      </div>
      {children}
    </>
  );
}
