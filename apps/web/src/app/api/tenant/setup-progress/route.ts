import { NextResponse } from "next/server";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export interface SetupProgressStep {
  id: string;
  label: string;
  description: string;
  href: string | null;
  done: boolean;
  optional: boolean;
}

export interface SetupProgressResponse {
  steps: SetupProgressStep[];
  requiredTotal: number;
  requiredDone: number;
  complete: boolean;
}

function hasAnyHours(businessHours: unknown): boolean {
  if (!businessHours || typeof businessHours !== "object") return false;
  return Object.values(businessHours as Record<string, unknown>).some(
    (day) => Array.isArray(day) && day.length > 0,
  );
}

/**
 * Setup-progress panel data (Cluster H task brief item 1) — every step
 * computed from real, currently-queryable state, never a client-side
 * fabricated/decorative checklist. Runs against the caller's own
 * RLS-bound session (every table read here is already tenant-select-able
 * by an authenticated member) rather than service role.
 *
 * "Team invited" now links to a real `/dashboard/team` page
 * (FIX_REQUESTS.md — `api-team-invite`); `done` still reads the real
 * `memberships` count rather than anything the invite flow itself
 * reports. "Policies reviewed" reads the precise
 * `tenants.policies_reviewed_at` timestamp (FIX_REQUESTS.md — set by
 * `api/tenant/agent/vertical-details`'s own POST handler the moment a
 * tenant owner/admin saves a non-empty cancellation_policy.text) instead
 * of the prior proxy.
 */
export async function GET() {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // SIGNUP-1 fix (docs/BUILD_NOTES.md): see claims.ts's doc comment —
  // `user.app_metadata` never carries the Custom Access Token Hook's
  // tenant_id. Confirmed live: this endpoint 403'd for a real, freshly
  // provisioned tenant owner before this fix.
  const claims = await claimsFromSupabaseClient(supabase);
  if (!claims.tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const tenantId = claims.tenant_id;

  const [
    { data: tenant },
    { data: agentConfig },
    { data: phoneNumber },
    { count: testCallCount },
    { count: offeringCount },
    { count: resourceCount },
    { count: membershipCount },
    { count: adapterCount },
  ] = await Promise.all([
    supabase
      .from("tenants")
      .select("status, a2p_status, business_hours, policies_reviewed_at")
      .eq("id", tenantId)
      .maybeSingle(),
    supabase
      .from("agent_configs")
      .select("published_at, dynamic_variable_overrides")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("phone_numbers")
      .select("e164, forwarding_verified_at")
      .eq("tenant_id", tenantId)
      .is("released_at", null)
      .maybeSingle(),
    supabase
      .from("call_logs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_test_call", true),
    supabase
      .from("offerings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("active", true),
    supabase
      .from("resources")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("active", true),
    supabase
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
    supabase
      .from("adapter_connections")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "connected"),
  ]);

  const overrides = (agentConfig?.dynamic_variable_overrides ?? {}) as {
    delivery?: unknown;
  };

  const steps: SetupProgressStep[] = [
    {
      id: "paid",
      label: "Add a payment method",
      description: "Your plan needs an active subscription before calls can bill.",
      href: "/dashboard/billing",
      done: tenant?.status === "active",
      optional: false,
    },
    {
      id: "agent_provisioned",
      label: "Publish your AI agent",
      description: "Your assistant needs to be compiled and published at least once.",
      href: "/dashboard/agent",
      done: !!agentConfig?.published_at,
      optional: false,
    },
    {
      id: "business_hours",
      label: "Set your business hours",
      description: "Callers hear accurate hours and after-hours handling.",
      href: "/dashboard/agent/hours",
      done: hasAnyHours(tenant?.business_hours),
      optional: false,
    },
    {
      id: "services",
      label: "Add services or menu items",
      description: "Your AI can only book or sell what's configured here.",
      href: "/dashboard/setup/offerings",
      done: (offeringCount ?? 0) > 0 || (resourceCount ?? 0) > 0,
      optional: false,
    },
    {
      id: "policies_reviewed",
      label: "Review your cancellation & booking policy",
      description: "The agent reads this back to callers verbatim.",
      href: "/dashboard/agent/vertical-details",
      done: !!tenant?.policies_reviewed_at,
      optional: false,
    },
    {
      id: "test_call",
      label: "Test your agent",
      description: "Run a test call and confirm the transcript and booking look right.",
      href: "/dashboard/test-agent",
      done: (testCallCount ?? 0) > 0,
      optional: false,
    },
    {
      id: "forwarding",
      label: "Turn on call forwarding",
      description: "Forward your real business line so live calls reach your agent.",
      href: "/dashboard/phone-setup",
      done: !!phoneNumber?.forwarding_verified_at,
      optional: false,
    },
    {
      id: "delivery_preferences",
      label: "Set delivery preferences",
      description: "Choose how you're notified of new bookings, orders, and messages.",
      href: "/dashboard/delivery",
      done: overrides.delivery != null,
      optional: false,
    },
    {
      id: "team_invited",
      label: "Invite your team",
      description: "Give teammates their own dashboard sign-in.",
      href: "/dashboard/team",
      done: (membershipCount ?? 0) > 1,
      optional: true,
    },
    {
      id: "a2p",
      label: "Complete SMS registration (A2P 10DLC)",
      description: "Required by carriers before booking/order text messages can send.",
      href: "/dashboard/delivery",
      done: tenant?.a2p_status === "verified",
      optional: false,
    },
    {
      id: "integrations",
      label: "Connect an integration (optional)",
      description: "Sync bookings to your existing calendar, POS, or CRM.",
      href: "/dashboard/integrations",
      done: (adapterCount ?? 0) > 0,
      optional: true,
    },
  ];

  const required = steps.filter((s) => !s.optional);
  const requiredDone = required.filter((s) => s.done).length;

  const body: SetupProgressResponse = {
    steps,
    requiredTotal: required.length,
    requiredDone,
    complete: requiredDone === required.length,
  };
  return NextResponse.json(body);
}
