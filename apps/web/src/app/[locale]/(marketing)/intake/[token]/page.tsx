import { Container, Section } from "@heyloo/ui";
import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { env } from "@/lib/env";
import { IntakeFormClient } from "./intake-form-client";

export const metadata: Metadata = { title: "Patient intake — Heyloo" };

interface IntakeLookup {
  valid: boolean;
  tenant_name?: string;
  patient_first_name?: string | null;
  already_submitted?: boolean;
}

/**
 * Public, unauthenticated secure intake form (GAP_REGISTER.md §2 Dental
 * item 2 — "secure link for DOB/insurance" had zero implementation). The
 * URL carries only an opaque token, never PHI or a tenant/patient id —
 * every identifying detail (which tenant, which patient) is resolved
 * SERVER-SIDE from the token by `api-intake` (Cluster G's edge function;
 * this cluster owns only the page/form — see docs/audit/FIX_REQUESTS.md
 * for the exact lookup/submit contract this page and
 * `intake-form-client.tsx` are built against). A token that doesn't
 * resolve (unknown, expired, already used) 404s rather than rendering a
 * form that can't submit — this route is reachable by anyone who has the
 * link, so it never distinguishes "wrong token" from "expired token" in
 * a way that would help someone guess a valid one.
 */
async function lookupToken(token: string): Promise<IntakeLookup | null> {
  try {
    const res = await fetch(`${env.supabaseFunctionsUrl}/api-intake/${encodeURIComponent(token)}`, {
      method: "GET",
      headers: { apikey: env.supabasePublishableKey },
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as IntakeLookup;
  } catch {
    return null;
  }
}

export default async function IntakeTokenPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const lookup = await lookupToken(token);
  if (!lookup?.valid) notFound();

  return (
    <Section spacing="default" className="min-h-svh">
      <Container size="content" className="max-w-lg">
        <div className="mb-6 flex items-center justify-center gap-2 text-small text-muted-foreground">
          <ShieldCheck className="size-4 text-success" aria-hidden="true" />
          Secure, private link — only visible to you
        </div>
        <IntakeFormClient
          token={token}
          tenantName={lookup.tenant_name ?? "your provider"}
          patientFirstName={lookup.patient_first_name ?? null}
          alreadySubmitted={!!lookup.already_submitted}
        />
      </Container>
    </Section>
  );
}
