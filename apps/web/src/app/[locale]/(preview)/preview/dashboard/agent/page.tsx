import type { Metadata } from "next";
import { redirect } from "next/navigation";

// Deliberate exception to the "re-export the real page unmodified" mirror
// pattern (docs/DESIGN_SYSTEM.md §UI Preview Mode): the real
// `(tenant)/dashboard/agent/page.tsx` is itself just
// `redirect("/dashboard/agent/greeting")` — a hardcoded absolute,
// non-preview-prefixed path. Re-exporting it here would bounce a preview
// viewer straight out of `/preview/**` into the real auth-gated route
// (round-3 tenant design review, blocker). This mirror has no content of
// its own to diverge from, so it redirects to its OWN sibling mirror
// instead, staying inside the preview route group.
export default function AgentIndexPreviewPage(): never {
  redirect("/preview/dashboard/agent/greeting");
}

export const metadata: Metadata = { title: "Agent — Heyloo" };
