import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "../lib/utils.js";

export const buttonVariants = cva(
  // Micro-interaction (WEBSITE_CREATIVE_BRIEF.md "magnetic buttons ok" /
  // DESIGN_SYSTEM.md "premium restraint"): a barely-there press (98%
  // scale) and lift (-1px), `transform` added to the existing transition
  // list so both animate on the same duration/ease tokens as the
  // color/shadow changes already here — CSS-only (no JS, no "use client"
  // needed), so every existing server-rendered call site keeps working
  // unchanged. `active:` fires on both mouse and touch; the lift is
  // skipped on `disabled`/`loading` (already `pointer-events-none`, so it
  // never fires) and on `variant="link"` (a lift would fight its
  // underline-on-hover affordance). Collapses to nothing under
  // `prefers-reduced-motion` via the blanket rule in
  // packages/ui/src/theme/globals.css — no per-component opt-out needed.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,border-color,color,opacity,box-shadow,transform] duration-(--duration-fast) ease-(--ease-out) disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 hover:-translate-y-px active:translate-y-0 active:scale-[0.98] [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        destructive: "bg-destructive text-destructive-foreground shadow-xs hover:opacity-90",
        outline: "border border-border bg-background hover:bg-secondary",
        secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
        ghost: "hover:bg-secondary",
        // text-accent-text (not text-primary): at normal link weight/size
        // on a light background, the base accent-500 measures 3.57:1 — below
        // WCAG AA's 4.5:1 for normal text (axe color-contrast, round-final
        // tenant review). The dedicated text/link accent token — accent-600
        // under the hood, same value bg-primary's hover state uses, but a
        // separate semantic token so a button-hover retune can't silently
        // drag link-text contrast down with it (DESIGN-4) — clears AA in
        // both themes (~4.99:1 light, ~7.73:1 dark).
        // No lift/press here — `link` reads as inline text, not a
        // raised surface, so it keeps only its underline-on-hover
        // affordance (`hover:translate-y-0`/`active:scale-100` cancel
        // the base variant's lift/press for this one).
        link: "text-accent-text underline-offset-4 hover:underline hover:translate-y-0 active:scale-100",
      },
      size: {
        // 44px (h-11) below the `lg` (1024px) breakpoint — the default size
        // backs nearly every primary CTA across the app (Send invite, Save,
        // Add resource/offering, Manage payment method, …), and at the
        // stock 36px (h-9) it measured under the 44px touch-target
        // guidance at mobile/tablet widths (390/768, round-final tenant
        // review, medium). Desktop (>=1024px, mouse-driven) keeps the
        // tighter 36px "premium restraint" sizing already reviewed there.
        default: "h-11 px-4 py-2 lg:h-9",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-md px-6",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  ref?: Ref<HTMLButtonElement> | undefined;
  /** Shows a spinner in place of the leading icon and disables the button — for an in-flight async action (never pair with `asChild`, which renders a non-`<button>` element this can't safely disable). */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ref,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  // `asChild` renders Radix's `Slot`, which requires exactly one element
  // child (`Children.only`) — the loading spinner is only injected on the
  // plain `<button>` path; pass `children` through untouched for `asChild`.
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
          {children}
        </>
      )}
    </Comp>
  );
}
