"use client";

import { CARRIERS, type PhonePortInRequest } from "@heyloo/canonical-types";
import { Button, Input, Label } from "@heyloo/ui";
import { useState } from "react";
import { toast } from "sonner";
import { normalizePhone, PHONE_ERROR_MESSAGE } from "@/lib/settings/phone";
import { CARRIER_LABELS } from "./carrier-codes";

type Field = "current_number" | "account_number" | "carrier";
type FieldErrors = Partial<Record<Field, string>>;

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm aria-[invalid=true]:border-destructive";

/** Port-in form (QA-1 F-15): labelled fields, per-field errors, number normalized to E.164, and no PIN — support collects that securely. */
export function PortInForm({ onBack }: { onBack: () => void }) {
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentNumber, setCurrentNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [carrier, setCarrier] = useState<PhonePortInRequest["carrier"] | "">("");
  const [errors, setErrors] = useState<FieldErrors>({});

  function validate(): PhonePortInRequest | null {
    const next: FieldErrors = {};
    const e164 = normalizePhone(currentNumber);
    if (!e164) next.current_number = PHONE_ERROR_MESSAGE;
    if (accountNumber.trim().length === 0) next.account_number = "Account number is required.";
    if (carrier === "") next.carrier = "Choose your current carrier.";
    setErrors(next);
    if (Object.keys(next).length > 0 || !e164 || carrier === "") return null;
    return { current_number: e164, account_number: accountNumber.trim(), carrier };
  }

  async function submit() {
    const payload = validate();
    if (!payload) return;
    setSaving(true);
    try {
      const res = await fetch("/api/phone/port-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSubmitted(true);
        return;
      }
      if (res.status === 422) {
        const body = (await res.json().catch(() => null)) as {
          issues?: Array<{ path?: Array<string | number>; message?: string }>;
        } | null;
        const server: FieldErrors = {};
        for (const issue of body?.issues ?? []) {
          const key = issue.path?.[0];
          if (key === "current_number" || key === "account_number" || key === "carrier") {
            server[key] ??= issue.message ?? "Check this field.";
          }
        }
        if (Object.keys(server).length > 0) {
          setErrors(server);
          return;
        }
      }
      toast.error("Something went wrong — please try again.");
    } catch {
      toast.error("Something went wrong — please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-md space-y-2 text-center" role="status">
        <p className="font-medium text-success">Port-in requested</p>
        <p className="text-sm text-muted-foreground">
          This can take several business days. Our team will contact you at your account email to
          finish it, and you can follow along under Support. They&apos;ll ask for your carrier
          account PIN securely then — we don&apos;t collect it here.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <button type="button" onClick={onBack} className="text-xs text-muted-foreground underline">
        ← Back to forwarding
      </button>

      <div className="space-y-1">
        <Label htmlFor="port-current-number">Current business number</Label>
        <Input
          id="port-current-number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(610) 555-0100"
          value={currentNumber}
          aria-invalid={errors.current_number ? true : undefined}
          aria-describedby={errors.current_number ? "port-current-number-error" : undefined}
          onChange={(e) => setCurrentNumber(e.target.value)}
        />
        {errors.current_number && (
          <p id="port-current-number-error" className="text-xs text-destructive" role="alert">
            {errors.current_number}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="port-carrier">Current carrier</Label>
        <select
          id="port-carrier"
          className={SELECT_CLASS}
          value={carrier}
          aria-invalid={errors.carrier ? true : undefined}
          aria-describedby={errors.carrier ? "port-carrier-error" : undefined}
          onChange={(e) => setCarrier(e.target.value as PhonePortInRequest["carrier"] | "")}
        >
          <option value="">Select carrier</option>
          {CARRIERS.map((c) => (
            <option key={c} value={c}>
              {CARRIER_LABELS[c]}
            </option>
          ))}
        </select>
        {errors.carrier && (
          <p id="port-carrier-error" className="text-xs text-destructive" role="alert">
            {errors.carrier}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="port-account-number">Carrier account number</Label>
        <Input
          id="port-account-number"
          autoComplete="off"
          value={accountNumber}
          aria-invalid={errors.account_number ? true : undefined}
          aria-describedby={errors.account_number ? "port-account-number-error" : undefined}
          onChange={(e) => setAccountNumber(e.target.value)}
        />
        {errors.account_number && (
          <p id="port-account-number-error" className="text-xs text-destructive" role="alert">
            {errors.account_number}
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        You don&apos;t need to enter your account PIN here — our team asks for it securely when the
        port starts.
      </p>

      <Button className="w-full" onClick={() => void submit()} disabled={saving}>
        {saving ? "Sending…" : "Request port-in"}
      </Button>
    </div>
  );
}
