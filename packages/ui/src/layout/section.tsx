import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils.js";

export interface SectionProps extends HTMLAttributes<HTMLElement> {
  /** Vertical rhythm on the 8pt grid — `compact` for dense in-app screens, `spacious` for marketing pages. */
  spacing?: "compact" | "default" | "spacious";
  as?: "section" | "div";
}

const SPACING = {
  compact: "py-8 md:py-10",
  default: "py-12 md:py-16",
  spacious: "py-20 md:py-28",
} as const;

/** A vertical rhythm block — marketing/dashboard sections share this instead of ad-hoc `py-*` per page. */
export function Section({
  className,
  spacing = "default",
  as = "section",
  ...props
}: SectionProps) {
  const Comp = as;
  return <Comp className={cn(SPACING[spacing], className)} {...props} />;
}
