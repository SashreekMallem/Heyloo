import { messagingBusinessProfileSchema } from "@heyloo/canonical-types";
import { NextResponse } from "next/server";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import {
  type MessagingSetupResponse,
  type TextingSender,
  textingState,
} from "@/lib/messaging/texting-setup";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * MESSAGING-1 (docs/design/MESSAGING_PROVIDERS.md): the owner's "Text
 * messaging setup". GET = where carrier approval stands + the saved
 * business details; PUT = save the business details carriers require
 * (IRS legal name, EIN, address, contact) for toll-free verification /
 * 10DLC brand registration. Reads and writes go through the caller's own
 * session under RLS (`messaging_business_profiles` is owner/admin-only,
 * `messaging_senders` is read-only for tenants) — no service role here.
 */

function formatEin(digits: string | null): string | undefined {
  if (!digits) return undefined;
  return digits.length === 9 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits;
}

type Supabase = Awaited<ReturnType<typeof createSupabaseServerComponentClient>>;

async function authorize(): Promise<
  | { ok: false; response: NextResponse }
  | { ok: true; supabase: Supabase; tenantId: string; canEdit: boolean }
> {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    };
  }
  const claims = await claimsFromSupabaseClient(supabase);
  if (!claims.tenant_id) {
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  const canEdit = claims.role === "owner" || claims.role === "admin";
  return { ok: true, supabase, tenantId: claims.tenant_id, canEdit };
}

export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const { supabase, tenantId, canEdit } = auth;

  const [{ data: tenant }, { data: senders }, { data: profile }] = await Promise.all([
    supabase.from("tenants").select("a2p_status").eq("id", tenantId).maybeSingle(),
    supabase
      .from("messaging_senders")
      .select("e164, kind, registration_status, failure_reason, is_default")
      .eq("tenant_id", tenantId)
      .is("released_at", null),
    supabase
      .from("messaging_business_profiles")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const senderRows = Array.isArray(senders) ? senders : [];
  const primary =
    senderRows.find((s) => s.is_default && s.registration_status === "verified") ??
    senderRows.find((s) => s.is_default) ??
    senderRows[0] ??
    null;
  const sender: TextingSender | null = primary
    ? {
        e164: primary.e164,
        kind: primary.kind,
        registration_status: primary.registration_status,
        failure_reason: primary.failure_reason ?? null,
      }
    : null;

  const body: MessagingSetupResponse = {
    state: textingState({
      a2pStatus: tenant?.a2p_status ?? null,
      sender,
      profileSubmitted: !!profile?.submitted_at,
    }),
    sender,
    profile: profile
      ? {
          legal_name: profile.legal_name,
          ...(profile.dba_name ? { dba_name: profile.dba_name } : {}),
          business_type: profile.business_type,
          ...(profile.ein ? { ein: formatEin(profile.ein) } : {}),
          ...(profile.website_url ? { website_url: profile.website_url } : {}),
          street_line1: profile.street_line1 ?? "",
          ...(profile.street_line2 ? { street_line2: profile.street_line2 } : {}),
          city: profile.city ?? "",
          region: profile.region ?? "",
          postal_code: profile.postal_code ?? "",
          contact_first_name: profile.contact_first_name ?? "",
          contact_last_name: profile.contact_last_name ?? "",
          contact_email: profile.contact_email ?? "",
          contact_phone: profile.contact_phone_e164 ?? "",
          monthly_volume_estimate: profile.monthly_volume_estimate ?? 1,
          submitted_at: profile.submitted_at,
        }
      : null,
    can_edit: canEdit,
  };
  return NextResponse.json(body);
}

export async function PUT(request: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const { supabase, tenantId, canEdit } = auth;
  if (!canEdit) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = messagingBusinessProfileSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const p = parsed.data;

  const { error } = await supabase.from("messaging_business_profiles").upsert(
    {
      tenant_id: tenantId,
      legal_name: p.legal_name,
      dba_name: p.dba_name ?? null,
      business_type: p.business_type,
      ein: p.ein ? p.ein.replace(/\D/g, "") : null,
      website_url: p.website_url ?? null,
      street_line1: p.street_line1,
      street_line2: p.street_line2 ?? null,
      city: p.city,
      region: p.region,
      postal_code: p.postal_code,
      country: "US",
      contact_first_name: p.contact_first_name,
      contact_last_name: p.contact_last_name,
      contact_email: p.contact_email,
      contact_phone_e164: p.contact_phone,
      monthly_volume_estimate: p.monthly_volume_estimate,
      submitted_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
