import { Check, Loader2, X } from "lucide-react";
import { cn } from "../lib/utils.js";

export interface ProvisioningStep {
  key: string;
  label: string;
  status: "pending" | "in_progress" | "succeeded" | "failed";
}

/** Live saga step list — signup step 5 (FRONTEND_SPEC.md §1.3/§4.5). */
export function ProvisioningTimeline({ steps }: { steps: ProvisioningStep[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-3">
          <div
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full",
              step.status === "succeeded" && "bg-success text-success-foreground",
              step.status === "in_progress" && "bg-primary text-primary-foreground",
              step.status === "failed" && "bg-destructive text-destructive-foreground",
              step.status === "pending" && "bg-muted text-muted-foreground",
            )}
          >
            {step.status === "succeeded" && <Check className="size-3.5" />}
            {step.status === "in_progress" && <Loader2 className="size-3.5 animate-spin" />}
            {step.status === "failed" && <X className="size-3.5" />}
          </div>
          <span
            className={cn(
              "text-sm",
              step.status === "pending" ? "text-muted-foreground" : "font-medium",
            )}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
