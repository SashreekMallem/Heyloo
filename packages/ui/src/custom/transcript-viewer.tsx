"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../lib/utils.js";
import { Input } from "../primitives/input.js";

export interface TranscriptTurn {
  speaker: string;
  text: string;
  ts: number;
}

export interface TranscriptViewerProps {
  turns: TranscriptTurn[];
  activeTs?: number;
  onSeek?: (ts: number) => void;
  className?: string;
}

/** Turn-by-turn transcript, speaker-colored, timestamped, searchable, clickable turns — call detail (FRONTEND_SPEC.md §1.3/§6.3). */
export function TranscriptViewer({ turns, activeTs, onSeek, className }: TranscriptViewerProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return turns;
    const needle = query.toLowerCase();
    return turns.filter((turn) => (turn.text ?? "").toLowerCase().includes(needle));
  }, [turns, query]);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transcript…"
          className="pl-9"
        />
      </div>
      <div className="space-y-3">
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">No matching turns.</p>
        )}
        {filtered.map((turn, index) => {
          const speaker = turn.speaker ?? "";
          const isCaller =
            speaker.toLowerCase().includes("caller") || speaker.toLowerCase() === "user";
          const isActive = activeTs === turn.ts;
          return (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: read-only filtered transcript, ts can repeat across turns
              key={`${turn.ts}-${index}`}
              type="button"
              onClick={() => onSeek?.(turn.ts)}
              className={cn(
                "flex w-full flex-col items-start gap-1 rounded-md p-2 text-left transition-colors",
                isActive ? "bg-secondary" : "hover:bg-muted/60",
              )}
            >
              <span
                className={cn(
                  "text-xs font-medium",
                  // text-accent-text, not text-primary: base accent-500
                  // measures 3.42:1 for this small speaker label on a light
                  // background, below WCAG AA's 4.5:1 (axe color-contrast,
                  // round-final tenant review). The dedicated text/link
                  // accent token (accent-600) clears AA in both themes
                  // (DESIGN-4).
                  isCaller ? "text-accent-text" : "text-accent-foreground",
                )}
              >
                {turn.speaker} · {formatSeconds(turn.ts)}
              </span>
              <span className="text-sm">{turn.text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatSeconds(ts: number): string {
  const minutes = Math.floor(ts / 60);
  const seconds = Math.floor(ts % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
