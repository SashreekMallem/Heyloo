import { cn } from "../lib/utils.js";

export type RealtimeStatus = "connecting" | "connected" | "reconnecting" | "offline";

const STATUS_META: Record<RealtimeStatus, { color: string; label: string }> = {
  connecting: { color: "bg-warning", label: "Connecting…" },
  connected: { color: "bg-success", label: "Live" },
  reconnecting: { color: "bg-warning", label: "Reconnecting…" },
  offline: { color: "bg-destructive", label: "Live updates paused — refresh to catch up" },
};

/** Connection dot in the tenant topbar, always shown, colored by state (FRONTEND_SPEC.md §1.3/§9.6). */
export function RealtimeIndicator({
  status,
  className,
}: {
  status: RealtimeStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <div
      className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}
      title={meta.label}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          meta.color,
          status === "connecting" || status === "reconnecting" ? "animate-pulse" : "",
        )}
      />
      {status === "offline" && <span className="hidden sm:inline">{meta.label}</span>}
    </div>
  );
}
