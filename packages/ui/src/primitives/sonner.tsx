import type { CSSProperties } from "react";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

export { toast } from "sonner";

/** Ephemeral toasts (FRONTEND_SPEC.md §9.4) — mutation success/failure, non-blocking-warning pattern for partial failures (e.g. SMS-send-after-successful-booking). */
export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as CSSProperties
      }
      {...props}
    />
  );
}
