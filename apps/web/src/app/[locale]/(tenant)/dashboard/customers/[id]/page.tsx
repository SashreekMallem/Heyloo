import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  CustomerDetailClient,
  type CustomerDetailData,
} from "@/components/tenant/customer-detail-client";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";

export const metadata: Metadata = { title: "Customer — Heyloo" };

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, tenant } = await requireTenantSession(`/dashboard/customers/${id}`);

  const { data: customer } = await supabase
    .from("customers")
    .select("id, name, phone_e164, email, segment, lifetime_value_cents, metadata, consent")
    .eq("tenant_id", tenant.id)
    .eq("id", id)
    .maybeSingle();
  if (!customer) notFound();

  const [{ data: calls }, { data: bookings }] = await Promise.all([
    supabase
      .from("call_logs")
      .select("id, started_at, classification")
      .eq("tenant_id", tenant.id)
      .eq("caller_number", customer.phone_e164)
      // Voice-only "Calls" history on the customer profile: exclude
      // text-agent shadow rows (channel 'sms'/'web_chat', started_at
      // always null) — same fix as calls-list-client.tsx.
      .in("channel", ["phone", "web_voice"])
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(10),
    supabase
      .from("bookings")
      .select("id, start_at, status")
      .eq("tenant_id", tenant.id)
      .eq("customer_id", customer.id)
      .order("start_at", { ascending: false })
      .limit(10),
  ]);

  const data: CustomerDetailData = {
    id: customer.id,
    name: customer.name,
    phone: customer.phone_e164,
    email: customer.email,
    segment: customer.segment,
    lifetimeValueCents: customer.lifetime_value_cents,
    metadata: customer.metadata ?? {},
    consent: customer.consent ?? null,
    calls: (calls ?? []).map((c) => ({
      id: c.id,
      startedAt: c.started_at,
      classification: c.classification,
    })),
    bookings: (bookings ?? []).map((b) => ({ id: b.id, startAt: b.start_at, status: b.status })),
  };

  return <CustomerDetailClient customer={data} />;
}
