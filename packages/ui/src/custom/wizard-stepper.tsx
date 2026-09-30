import { Check } from "lucide-react";
import { cn } from "../lib/utils.js";

export interface WizardStepperProps {
  steps: string[];
  current: number;
  completed: number[];
  className?: string;
}

/** Generic numbered-step header — signup, phone setup, config lab (FRONTEND_SPEC.md §1.3). */
export function WizardStepper({ steps, current, completed, className }: WizardStepperProps) {
  return (
    <ol className={cn("flex w-full items-center gap-2", className)}>
      {steps.map((step, index) => {
        const isDone = completed.includes(index);
        const isCurrent = index === current;
        return (
          <li
            key={step}
            aria-current={isCurrent ? "step" : undefined}
            className="flex min-w-0 flex-1 items-center gap-2"
          >
            <div
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                isDone
                  ? "bg-success text-success-foreground"
                  : isCurrent
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {isDone ? <Check className="size-3.5" /> : index + 1}
            </div>
            {/* Labels never wrap (QA-1 F-18: "Business info" broke onto two
                lines at 1440). Below lg only the current step keeps its label
                so a 4-step header still fits on one line. */}
            <span
              className={cn(
                "hidden whitespace-nowrap text-sm",
                isCurrent ? "font-medium sm:inline" : "text-muted-foreground lg:inline",
              )}
            >
              {step}
            </span>
            {index < steps.length - 1 && <div className="h-px min-w-3 flex-1 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}
