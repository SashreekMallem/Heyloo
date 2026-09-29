"use client";

import { Callout } from "@heyloo/ui";
import { READ_ONLY_MESSAGE, useCanWriteSettings } from "@/lib/tenant/tenant-context";

/**
 * QA-1 (F-5/SEC-07/AUTH-15): rendered at the top of a settings page for a
 * signed-in `member`, who can read but not change owner settings. RLS and
 * the route guards stay the authority; this only stops the UI promising a
 * save that would be dropped.
 */
export function ReadOnlyNote({ message = READ_ONLY_MESSAGE }: { message?: string }) {
  const canWrite = useCanWriteSettings();
  if (canWrite) return null;
  return (
    <Callout tone="info" role="note" data-testid="read-only-note">
      {message}
    </Callout>
  );
}
