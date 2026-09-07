import { NextResponse } from "next/server";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

export interface PriceCardResponse {
  vertical: string;
  base_cents: number;
  included_minutes: number;
  overage_cents: number;
  annual_discount_pct: number;
}

/**
 * Signup step 2's price reveal (FRONTEND_SPEC.md §4.2) — the only place
 * the real price card is shown pre-signup. `platform_settings` is
 * admin-only RLS (BACKEND_SPEC/RLS migration), so this Route Handler reads
 * it with the service-role client rather than exposing it to a
 * client-direct query, per FRONTEND_SPEC.md's explicit instruction.
 */
export async function GET(request: Request) {
  const vertical = new URL(request.url).searchParams.get("vertical") ?? "generic";
  const supabase = createSupabaseServiceRoleServerClient();

  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", `price_card_${vertical}`)
    .maybeSingle();

  const fallback = data
    ? null
    : await supabase
        .from("platform_settings")
        .select("value")
        .eq("key", "price_card_generic")
        .maybeSingle();

  const row = data ?? fallback?.data;
  const value = (row?.value ?? {}) as Partial<PriceCardResponse>;

  const discountRow = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "annual_discount_pct")
    .maybeSingle();
  const annualDiscount = (discountRow.data?.value as { pct?: number } | undefined)?.pct ?? 12;

  const body: PriceCardResponse = {
    vertical,
    base_cents: value.base_cents ?? 29900,
    included_minutes: value.included_minutes ?? 300,
    overage_cents: value.overage_cents ?? 45,
    annual_discount_pct: annualDiscount,
  };

  return NextResponse.json(body);
}
