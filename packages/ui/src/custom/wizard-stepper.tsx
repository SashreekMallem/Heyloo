import { Check } from "lucide-react";
import { cn } from "../lib/utils.js";

export interface WizardStepperProps {
  steps: string[];
  current: number;
  completed: number[];
  className?: string;
}

/** Container width at which every label fits on one line, by step count
 * (literal class names so Tailwind generates them). */
const ALL_LABELS_MIN_WIDTH: Record<number, string> = {
  1: "@xs:inline",
  2: "@md:inline",
  3: "@xl:inline",
  4: "@2xl:inline",
  5: "@3xl:inline",
  6: "@4xl:inline",
};

/** Generic numbered-step header — signup, phone setup, config lab (FRONTEND_SPEC.md §1.3). */
export function WizardStepper({ steps, current, completed, className }: WizardStepperProps) {
  return (
    // `@container`: label visibility follows the stepper's OWN width, not the
    // viewport's. At lg the signup wizard's narrow (max-w-md) column still
    // showed all six nowrap labels, which ran into each other.
    <ol className={cn("@container flex w-full items-center gap-2", className)}>
      {steps.map((step, index) => {
        const isDone = completed.includes(index);
        const isCurrent = index === current;
        return (
          <li
            key={step}
            aria-current={isCurrent ? "step" : undefined}
            // The current step never shrinks below its own label; the rest share
            // what is left (equal slices clipped "Account" to "Accou").
            className={cn(
              "flex min-w-0 items-center gap-2",
              isCurrent ? "flex-[1_0_auto]" : "flex-1",
            )}
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
                lines at 1440). Every label shows only when the stepper itself
                has room for all of them on one line (≈ 7rem per step); in a
                narrower stepper only the current step keeps its label. */}
            <span
              className={cn(
                "hidden whitespace-nowrap text-sm",
                isCurrent ? "font-medium @2xs:inline" : "text-muted-foreground",
                !isCurrent && ALL_LABELS_MIN_WIDTH[Math.min(steps.length, 6)],
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
