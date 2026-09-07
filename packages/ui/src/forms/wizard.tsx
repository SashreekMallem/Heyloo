"use client";

import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

/** Generic step-machine driver backing `WizardStepper` + every multi-step flow (signup, phone setup, config lab publish). Steps are identified by index; the caller owns routing (each signup step is its own route per FRONTEND_SPEC.md §4) or in-page state (the demo flow, §3.4). */
interface WizardContextValue {
  currentIndex: number;
  totalSteps: number;
  completed: Set<number>;
  goTo: (index: number) => void;
  next: () => void;
  back: () => void;
  markCompleted: (index: number) => void;
}

const WizardContext = createContext<WizardContextValue | null>(null);

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard must be used within <Wizard>");
  return ctx;
}

export interface WizardProps {
  totalSteps: number;
  initialIndex?: number;
  onStepChange?: (index: number) => void;
  children: ReactNode;
}

export function Wizard({ totalSteps, initialIndex = 0, onStepChange, children }: WizardProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [completed, setCompleted] = useState<Set<number>>(new Set());

  const value = useMemo<WizardContextValue>(
    () => ({
      currentIndex,
      totalSteps,
      completed,
      goTo: (index) => {
        const clamped = Math.max(0, Math.min(totalSteps - 1, index));
        setCurrentIndex(clamped);
        onStepChange?.(clamped);
      },
      next: () => {
        setCompleted((prev) => new Set(prev).add(currentIndex));
        setCurrentIndex((prev) => {
          const nextIndex = Math.min(totalSteps - 1, prev + 1);
          onStepChange?.(nextIndex);
          return nextIndex;
        });
      },
      back: () => {
        setCurrentIndex((prev) => {
          const prevIndex = Math.max(0, prev - 1);
          onStepChange?.(prevIndex);
          return prevIndex;
        });
      },
      markCompleted: (index) => setCompleted((prev) => new Set(prev).add(index)),
    }),
    [currentIndex, totalSteps, completed, onStepChange],
  );

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}
