import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Proxies a raw pasted/uploaded menu to the `api-menu-import` edge function
 * (GAP_REGISTER.md §4 Cluster E "menu import UI calling cluster G's
 * api-menu-import" — that function's own implementation is Cluster G's,
 * not this cluster's file ownership; see docs/audit/FIX_REQUESTS.md for
 * the exact contract this route/the UI depend on). Mirrors the
 * `api/admin/[...path]` proxy's shape: forward the caller's own access
 * token, let the edge function's own `verify_jwt` + tenant-id-from-JWT
 * resolve the tenant (never a client-supplied tenant_id, CLAUDE.md Rule 2).
 * This route only PARSES — it never writes `offerings` itself; confirmed
 * rows are persisted via `POST /api/tenant/offerings/bulk` after the
 * tenant reviews them in the UI.
 *
 * Expected request: EITHER `{ raw_text: string }` (plain-text menu, pasted
 * or read client-side from a `.txt`/`.csv`/`.md` upload) OR
 * `{ source: { kind: "url"; url } }` / `{ source: { kind: "file";
 * media_type; data_base64 } }` (image/PDF menu, base64-encoded
 * client-side) — the SAME discriminated shape the edge function's own
 * `MenuImportRequestSchema`
 * (`supabase/functions/_shared/schemas/menu-import.ts`) validates, so this
 * proxy forwards the body unchanged rather than reshaping it.
 * Expected response: `{ items: Array<{ name: string; category?: string;
 * price_cents?: number; duration_minutes?: number; allergens?: string[];
 * modifiers?: Array<{ name: string; price_cents?: number }> }> }` — the
 * SAME shape `offeringWriteSchema` (`../schema.ts`) already validates, so
 * a parsed row can go straight into the review form with no reshaping.
 */
const ImageMediaTypeSchema = z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const UrlSourceSchema = z.object({
  kind: z.literal("url"),
  url: z.url().refine((u) => /^https?:\/\//i.test(u), { message: "url must be http(s)" }),
});

const FileSourceSchema = z.object({
  kind: z.literal("file"),
  media_type: z.union([ImageMediaTypeSchema, z.literal("application/pdf")]),
  data_base64: z.string().min(1).max(14_000_000),
});

const importRequestSchema = z
  .object({
    raw_text: z.string().trim().min(1).max(50_000).optional(),
    source: z.discriminatedUnion("kind", [UrlSourceSchema, FileSourceSchema]).optional(),
  })
  .refine((v) => !!v.raw_text || !!v.source, {
    message: "either raw_text or source is required",
  });

export async function POST(request: Request) {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = importRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  let res: Response;
  try {
    res = await fetch(`${env.supabaseFunctionsUrl}/api-menu-import`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return NextResponse.json({ error: "import_unavailable" }, { status: 503 });
  }
  if (res.status === 404) {
    // Not deployed yet — degrade honestly rather than fake a parse.
    return NextResponse.json({ error: "import_unavailable" }, { status: 503 });
  }
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
