// Declares every env var this app reads as a concrete `ProcessEnv` property
// (not the ambient index signature) for two reasons: (1) the repo's strict
// tsconfig sets `noPropertyAccessFromIndexSignature`, which would otherwise
// force bracket access everywhere; (2) Next.js's build-time inlining of
// `NEXT_PUBLIC_*` vars for the browser bundle specifically pattern-matches
// `process.env.NEXT_PUBLIC_X` dot-notation in source — bracket access is
// NOT reliably replaced, so these must stay real properties read with dot
// notation (see src/lib/env.ts).
declare namespace NodeJS {
  interface ProcessEnv {
    readonly NEXT_PUBLIC_SUPABASE_URL: string;
    readonly NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
    readonly NEXT_PUBLIC_POSTHOG_KEY?: string;
    readonly NEXT_PUBLIC_POSTHOG_HOST?: string;
    readonly NEXT_PUBLIC_SENTRY_DSN?: string;
    readonly SUPABASE_URL: string;
    readonly SUPABASE_SECRET_KEY: string;
    readonly APP_BASE_URL?: string;
    readonly STRIPE_PUBLISHABLE_KEY?: string;
    readonly SENTRY_DSN?: string;
    readonly NEXT_RUNTIME?: "nodejs" | "edge";
    readonly SIGNUP_DRAFT_SECRET: string;
  }
}
