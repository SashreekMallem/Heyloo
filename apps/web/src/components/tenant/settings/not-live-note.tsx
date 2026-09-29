"use client";

import { Badge, cn } from "@heyloo/ui";
import type { ReactNode } from "react";

/**
 * SETTINGS-1 (docs/BUILD_NOTES.md): an honest label for a setting the
 * portal saves but nothing on a call or text reads yet (the settings audit
 * found FAQ, special instructions, manager, parking, Manual Mode, text
 * persona and more stored but never used). Owners must never be told a
 * setting is working when it isn't.
 */
export function NotLiveBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-normal", className)}>
      Not used on calls yet
    </Badge>
  );
}

export function NotLiveNote({ children }: { children?: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Saved, but not used yet. </span>
      {children ??
        "Your AI doesn't read this setting today. We keep what you enter and it starts working automatically once support ships — no need to re-enter it."}
    </p>
  );
}
