import { EmptyState } from "@heyloo/ui/custom/empty-error-state";
import { Compass } from "lucide-react";
import { Link } from "@/i18n/navigation";

/** Cockpit 404 — renders inside the cockpit shell instead of Next's bare default page (QA-1 COCKPIT-F22). */
export default function CockpitNotFound() {
  return (
    <EmptyState
      className="mt-10 border-none"
      icon={<Compass className="size-8" />}
      title="Page not found"
      description="This cockpit page doesn't exist or has moved."
      action={
        <Link
          href="/cockpit"
          className="text-sm font-medium text-accent-text underline underline-offset-2"
        >
          Back to the cockpit
        </Link>
      }
    />
  );
}
