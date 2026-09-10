"use client";

import { Phone } from "lucide-react";
import { StatusBadge } from "./status-badge.js";

export interface CallSummary {
  id: string;
  callerNumber: string | null;
  classification: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
}

export interface CallFeedItemProps {
  call: CallSummary;
  onClick?: (call: CallSummary) => void;
}

/** One row in the live call feed — overview (FRONTEND_SPEC.md §1.3/§6.1). */
export function CallFeedItem({ call, onClick }: CallFeedItemProps) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(call)}
      className="flex w-full items-center justify-between gap-3 rounded-md p-2 text-left hover:bg-muted/60"
    >
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-full bg-secondary">
          <Phone className="size-4" />
        </div>
        <div>
          <p className="text-sm font-medium">{call.callerNumber ?? "Unknown number"}</p>
          <p className="text-xs text-muted-foreground">
            {call.startedAt
              ? new Date(call.startedAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "In progress"}
            {call.durationSeconds ? ` · ${Math.round(call.durationSeconds / 60)}m` : ""}
          </p>
        </div>
      </div>
      {call.classification && <StatusBadge variant="call-class" value={call.classification} />}
    </button>
  );
}
