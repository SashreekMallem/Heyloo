"use client";

import { type ChangeEvent, type Ref, useState } from "react";
import { Input } from "../primitives/input.js";

/**
 * Percentage-rate fields (e.g. sales tax) are stored as basis points
 * internally (100 bps = 1%, matching the backend's integer-rate convention
 * — see `zBps`/`tax_rate_bps` in canonical-types) — this control
 * displays/edits a plain percentage and reports basis points to the form,
 * mirroring `CentsInput`'s dollars<->cents split so an owner never has to
 * do the bps-to-percent math by hand (round-final tenant review, low:
 * vertical-details showed the raw "basis points" label/value).
 */
export interface BpsInputProps {
  value: number | undefined;
  onChange: (bps: number | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  ref?: Ref<HTMLInputElement> | undefined;
}

export function BpsInput({ value, onChange, placeholder, disabled, id, ref }: BpsInputProps) {
  const [text, setText] = useState(value === undefined ? "" : (value / 100).toString());

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setText(raw);
    if (raw.trim() === "") {
      onChange(undefined);
      return;
    }
    const percent = Number.parseFloat(raw);
    if (Number.isFinite(percent)) {
      onChange(Math.round(percent * 100));
    }
  }

  return (
    <div className="relative">
      <Input
        ref={ref}
        id={id}
        inputMode="decimal"
        className="pr-7"
        value={text}
        placeholder={placeholder ?? "0.00"}
        disabled={disabled}
        onChange={handleChange}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        %
      </span>
    </div>
  );
}

/**
 * Customer-facing alias (DESIGN-4): same rationale as `CurrencyInput` in
 * `cents-input.tsx` — "a percent input", not the basis-points storage
 * detail underneath.
 */
export const PercentInput = BpsInput;
export type PercentInputProps = BpsInputProps;
