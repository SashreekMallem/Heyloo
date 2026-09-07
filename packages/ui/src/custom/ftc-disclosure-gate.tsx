"use client";

import { useState } from "react";
import { Button } from "../primitives/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../primitives/card.js";
import { Checkbox } from "../primitives/checkbox.js";
import { Label } from "../primitives/label.js";

export interface FTCDisclosureGateProps {
  policyVersion: string;
  onAcknowledge: (policyVersion: string) => void | Promise<void>;
}

/** Blocking acknowledgment interstitial, no skip path (FRONTEND_SPEC.md §1.3/§8.4). */
export function FTCDisclosureGate({ policyVersion, onAcknowledge }: FTCDisclosureGateProps) {
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="mx-auto flex min-h-svh max-w-lg items-center justify-center p-4">
      <Card>
        <CardHeader>
          <CardTitle>FTC disclosure requirement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            You must disclose that you may earn a commission when sharing your referral link — for
            example, "I may earn a commission if you sign up through my link." This applies anywhere
            you share it: social media, email, or in person.
          </p>
          <div className="flex items-start gap-2">
            <Checkbox
              id="ftc-ack"
              checked={checked}
              onCheckedChange={(value) => setChecked(value === true)}
            />
            <Label htmlFor="ftc-ack" className="font-normal">
              I understand and agree to disclose my commission relationship when sharing my referral
              link.
            </Label>
          </div>
          <Button
            className="w-full"
            disabled={!checked || submitting}
            onClick={async () => {
              setSubmitting(true);
              await onAcknowledge(policyVersion);
              setSubmitting(false);
            }}
          >
            Acknowledge and continue
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
