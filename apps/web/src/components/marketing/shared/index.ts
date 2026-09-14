/**
 * `components/marketing/shared` — reusable, budget-conscious scroll/motion
 * section primitives (docs/DESIGN_SYSTEM.md's "add a section without
 * breaking the budget" note has the full guidance on which one to reach
 * for). Every component here is `prefers-reduced-motion`-safe by default
 * and transform/opacity-only on the main thread.
 */
export * from "./media-loop";
export * from "./parallax";
export * from "./reveal";
export * from "./sticky";
