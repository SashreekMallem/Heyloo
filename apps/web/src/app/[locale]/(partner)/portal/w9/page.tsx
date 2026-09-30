import { W9StatusBadge } from "@heyloo/ui/custom/w9-status-badge";
import { PageHeader } from "@heyloo/ui/layout/page-header";
import { Button } from "@heyloo/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@heyloo/ui/primitives/card";
import type { Metadata } from "next";
import { requirePartnerSession } from "@/lib/auth/require-partner-session";

export const metadata: Metadata = { title: "W-9 — Heyloo" };

const W9_SUPPORT_EMAIL = "support@heyloo.com";

/**
 * Hosted W-9 status only — no SSN/EIN ever touches our schema or this page's form state (FRONTEND_SPEC.md §8.3).
 *
 * PT-04: there is no automated W-9 provider yet, so the way to submit one is
 * to email support, who set `w9_status` (admin action:
 * `PATCH /api/admin/admin-referral-partners/[id]/w9`). The old button linked
 * to a generic third-party homepage that never moved the status. Payouts past
 * the $600 YTD threshold are held until the status is `verified`
 * (`job-referral-payouts`).
 */
export default async function W9Page() {
  const { partner } = await requirePartnerSession("/portal/w9");
  const subject = encodeURIComponent(`W-9 for partner ${partner.name}`);

  return (
    <div className="max-w-md space-y-6">
      <PageHeader title="W-9" description="Required before payouts pass $600 in a calendar year." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <W9StatusBadge status={partner.w9_status} />
          {partner.w9_status === "not_submitted" && (
            <>
              <p className="text-sm text-muted-foreground">
                Email us your completed W-9 and we&apos;ll mark it on file. Please don&apos;t paste
                your SSN or EIN anywhere in this portal.
              </p>
              <Button asChild>
                <a href={`mailto:${W9_SUPPORT_EMAIL}?subject=${subject}`}>
                  Email support to submit your W-9
                </a>
              </Button>
            </>
          )}
          {partner.w9_status === "submitted" && (
            <p className="text-sm text-muted-foreground">
              We&apos;ve received your W-9 and are reviewing it.
            </p>
          )}
          {partner.w9_status === "verified" && (
            <p className="text-sm text-muted-foreground">Your W-9 is on file and verified.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
