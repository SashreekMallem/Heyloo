import { cn } from "../lib/utils.js";

export interface StateTraceEntry {
  state: string;
  enteredAt: string;
}

export interface StateTraceViewerProps {
  trace: StateTraceEntry[];
  activeState?: string;
  onSeek?: (entry: StateTraceEntry) => void;
  className?: string;
}

/** List of conversation-graph states visited, clickable → seeks transcript (FRONTEND_SPEC.md §1.3/§6.3). */
export function StateTraceViewer({ trace, activeState, onSeek, className }: StateTraceViewerProps) {
  return (
    <ol className={cn("space-y-1", className)}>
      {trace.map((entry, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: read-only trace list, same state can repeat, never reordered
        <li key={`${entry.state}-${index}`}>
          <button
            type="button"
            onClick={() => onSeek?.(entry)}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60",
              activeState === entry.state && "bg-secondary font-medium",
            )}
          >
            <span>{entry.state}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(entry.enteredAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
