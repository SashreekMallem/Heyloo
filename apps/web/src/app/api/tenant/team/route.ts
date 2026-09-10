import { NextResponse } from "next/server";
import { claimsFromUser } from "@/lib/auth/claims";
import { env } from "@/lib/env";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

export interface TeamMember {
  id: string;
  role: "owner" | "admin" | "member";
  email: string | null;
  invited_email: string | null;
  accepted: boolean;
  created_at: string;
}

export interface TeamListResponse {
  members: TeamMember[];
}

/**
 * Lists this tenant's team (docs/audit/FIX_REQUESTS.md). Caller's own
 * session confirms tenant membership (`claims.tenant_id`), but resolving
 * an accepted member's EMAIL requires the Auth Admin API (`auth.users` is
 * not exposed to PostgREST) — service-role only, per-row, same endpoint
 * `supabase/functions/_shared/providers/supabase-admin.ts`'s
 * `getUserEmailById` uses server-side (that module is Deno-only and not
 * importable from this Next.js route, so this duplicates the same plain
 * `fetch` call rather than sharing code across runtimes).
 */
export async function GET() {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const claims = claimsFromUser(user);
  if (!claims.tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const service = createSupabaseServiceRoleServerClient();
  const { data: rows, error } = await service
    .from("memberships")
    .select("id, user_id, role, invited_email, accepted_at, created_at")
    .eq("tenant_id", claims.tenant_id)
    .order("created_at", { ascending: true });

  if (error || !rows) return NextResponse.json({ error: "list_failed" }, { status: 500 });

  const members: TeamMember[] = await Promise.all(
    rows.map(async (row): Promise<TeamMember> => {
      let email: string | null = null;
      try {
        const res = await fetch(
          `${env.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(row.user_id)}`,
          {
            headers: {
              apikey: env.supabaseSecretKey,
              authorization: `Bearer ${env.supabaseSecretKey}`,
            },
          },
        );
        if (res.ok) {
          const body = (await res.json()) as { email?: string };
          email = body.email ?? null;
        }
      } catch {
        // Best-effort — an unresolved email still shows the row (using
        // invited_email as a fallback), never hides a real membership.
      }
      return {
        id: row.id,
        role: row.role,
        email,
        invited_email: row.invited_email,
        accepted: !!row.accepted_at,
        created_at: row.created_at,
      };
    }),
  );

  return NextResponse.json({ members } satisfies TeamListResponse);
}
