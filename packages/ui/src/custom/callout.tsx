import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/utils.js";

export const calloutVariants = cva("flex gap-3 rounded-lg border p-4 text-small", {
  variants: {
    tone: {
      neutral: "border-border bg-muted/50 text-foreground",
      info: "border-info/25 bg-info/10 text-foreground [&_svg]:text-info",
      success: "border-success/25 bg-success/10 text-foreground [&_svg]:text-success",
      warning: "border-warning/30 bg-warning/10 text-foreground [&_svg]:text-warning",
      danger: "border-destructive/25 bg-destructive/10 text-foreground [&_svg]:text-destructive",
    },
  },
  defaultVariants: { tone: "neutral" },
});

const ICON: Record<string, typeof Info> = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: ShieldAlert,
};

export interface CalloutProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof calloutVariants> {
  title?: ReactNode;
  icon?: ReactNode;
}

/** Inline notice block — compliance/consent notes, disclosure text, policy reminders (used wherever a page needs a persistent, non-dismissable aside rather than a `Toast`). */
export function Callout({
  className,
  tone = "neutral",
  title,
  icon,
  children,
  ...props
}: CalloutProps) {
  const Icon = ICON[tone ?? "neutral"] ?? Info;
  return (
    <div className={cn(calloutVariants({ tone }), className)} {...props}>
      <div className="mt-0.5 shrink-0">{icon ?? <Icon className="size-4" />}</div>
      <div className="space-y-1">
        {title && <p className="font-medium">{title}</p>}
        <div className="text-muted-foreground [&:only-child]:text-foreground">{children}</div>
      </div>
    </div>
  );
}
