import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils.js";

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Caps the reading/content width. `full` removes the cap (dashboards at
   * 1440+ that want to use the full width rather than a centered strip —
   * DESIGN BRIEF: "no lonely centered strip in a sea of white"). */
  size?: "content" | "wide" | "full";
}

const SIZE = {
  content: "max-w-3xl",
  wide: "max-w-(--breakpoint-xl)",
  full: "max-w-none",
} as const;

/** Horizontal gutter + max-width wrapper — the one place page-level side padding is set (DESIGN BRIEF: minimum 16px gutter at every width). */
export function Container({ className, size = "wide", ...props }: ContainerProps) {
  return (
    <div className={cn("mx-auto w-full px-4 sm:px-6 lg:px-8", SIZE[size], className)} {...props} />
  );
}
