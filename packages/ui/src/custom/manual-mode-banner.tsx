import { AlertOctagon } from "lucide-react";
import { Button } from "../primitives/button.js";

export interface ManualModeBannerProps {
  since: string;
  onDisable?: () => void;
}

/** Persistent banner rendered on every dashboard page while `agent_configs.manual_mode = true` (FRONTEND_SPEC.md §1.3/§5). */
export function ManualModeBanner({ since, onDisable }: ManualModeBannerProps) {
  const sinceLabel = new Date(since).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm">
      <div className="flex items-center gap-2">
        <AlertOctagon className="size-4 text-warning" />
        <span>
          <strong className="font-medium">Manual Mode is on</strong> since {sinceLabel} — new
          bookings and orders are sent to you by SMS instead of being confirmed automatically.
        </span>
      </div>
      {onDisable && (
        <Button size="sm" variant="outline" onClick={onDisable}>
          Turn off
        </Button>
      )}
    </div>
  );
}
