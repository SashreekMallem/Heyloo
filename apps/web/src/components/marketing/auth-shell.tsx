import { Phone } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

export interface AuthShellProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Shared shell for `/login`, `/mfa/*`, `/reset-password*` (DESIGN BRIEF:
 * "auth pages: minimal, centered card, brand mark, no clutter"). Purely
 * presentational — every page keeps its own form logic, this only supplies
 * the frame.
 */
export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-12">
      <Link
        href="/"
        className="mb-8 flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Phone className="size-3.5" aria-hidden="true" />
        </span>
        <span className="font-display text-h4 font-semibold">Heyloo</span>
      </Link>

      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-md sm:p-8">
        <div className="mb-6 space-y-1.5 text-center">
          <h1 className="text-h3 font-display font-semibold text-balance">{title}</h1>
          {description && (
            <p className="text-small text-pretty text-muted-foreground">{description}</p>
          )}
        </div>
        {children}
      </div>

      {/* Footer links (e.g. "Forgot your password?") are bare inline text that
          measured 144x16; the vertical padding makes each a >= 44px tap target
          without moving the text much (QA-1 MAP-05). */}
      {footer && (
        <div className="mt-2 text-center text-small text-muted-foreground [&_a]:inline-block [&_a]:py-3.5">
          {footer}
        </div>
      )}
    </main>
  );
}
