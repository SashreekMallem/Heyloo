"use client";

import { Badge, cn } from "@heyloo/ui";

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
