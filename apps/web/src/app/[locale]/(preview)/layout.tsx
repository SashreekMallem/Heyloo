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
      {/*
       * `role="region"` + `aria-label` — a bare `<div>` here sits outside
       * every other landmark on the page (axe `region`), and
       * `text-warning` on `bg-warning/10` (a colored-text-on-tint pairing)
       * failed AA the same way the admin cockpit's "AAL2 verified" pill
       * did — `text-foreground` for the label text (plus a `text-warning`
       * icon-free bullet kept only on the border/background) stays AA
       * regardless of how `--warning` itself gets re-tuned (admin-partner
       * design review round 5).
       */}
      <section
        aria-label="Preview mode notice"
        className="sticky top-0 z-(--z-banner) flex items-center justify-between gap-3 border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-small text-foreground"
      >
        <span className="font-medium">UI Preview Mode — fixture data, no real auth or network</span>
        <a href="/preview" className="underline underline-offset-2">
          All preview routes
        </a>
      </section>
      {children}
    </>
  );
}
