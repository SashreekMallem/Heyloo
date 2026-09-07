import { Button, Card, CardContent, CardHeader, CardTitle, W9StatusBadge } from "@heyloo/ui";
import type { Metadata } from "next";
import { requirePartnerSession } from "@/lib/auth/require-partner-session";

export const metadata: Metadata = { title: "W-9 — Heyloo" };

/** Hosted W-9 status only — no SSN/EIN ever touches our schema or this page's form state (FRONTEND_SPEC.md §8.3). */
export default async function W9Page() {
  const { partner } = await requirePartnerSession("/portal/w9");

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-xl font-semibold">W-9</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <W9StatusBadge status={partner.w9_status} />
          {partner.w9_status !== "verified" && (
            <Button asChild>
              <a href="https://www.track1099.com" target="_blank" rel="noreferrer">
                Complete W-9
              </a>
            </Button>
          )}
          {partner.w9_status === "verified" && (
            <p className="text-sm text-muted-foreground">Your W-9 is on file and verified.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
