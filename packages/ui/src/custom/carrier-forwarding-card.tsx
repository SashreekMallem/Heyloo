"use client";

import { Copy, Phone } from "lucide-react";
import { Button } from "../primitives/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../primitives/card.js";

export interface ForwardingCode {
  label: string;
  code: string;
}

export interface CarrierForwardingCardProps {
  carrier: string;
  codes: ForwardingCode[];
  forwardingNumber: string;
}

/**
 * Per-carrier forwarding codes + tap-to-dial (FRONTEND_SPEC.md §1.3/§6.7).
 * `*72`/`*73`-style codes: VERIFY against each carrier's current published
 * forwarding-code docs before shipping real values — the codes passed in
 * here are tenant-config data, not hardcoded in this component.
 */
export function CarrierForwardingCard({
  carrier,
  codes,
  forwardingNumber,
}: CarrierForwardingCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{carrier} forwarding codes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {codes.map((code) => (
          <div
            key={code.label}
            className="flex items-center justify-between gap-2 rounded-md border border-border p-3"
          >
            <div>
              <p className="text-sm font-medium">{code.label}</p>
              <p className="font-mono text-sm text-muted-foreground">
                {code.code.replace("{number}", forwardingNumber)}
              </p>
            </div>
            <div className="flex gap-1">
              <Button variant="outline" size="icon" asChild>
                <a
                  href={`tel:${code.code.replace("{number}", forwardingNumber).replace(/[^\d*#+]/g, "")}`}
                >
                  <Phone className="size-4" />
                  <span className="sr-only">Dial {code.label}</span>
                </a>
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  navigator.clipboard?.writeText(code.code.replace("{number}", forwardingNumber))
                }
              >
                <Copy className="size-4" />
                <span className="sr-only">Copy {code.label}</span>
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
