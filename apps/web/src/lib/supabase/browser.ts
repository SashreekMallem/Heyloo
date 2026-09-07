"use client";

import { createSupabaseBrowserClient } from "@heyloo/supabase-client";
import { env } from "../env";

/** One browser client per tab (module-scope singleton) — cookie session via @supabase/ssr, no tokens in localStorage (FRONTEND_STACK.md). */
export const supabaseBrowserClient = createSupabaseBrowserClient(
  env.supabaseUrl,
  env.supabasePublishableKey,
);
