"use client";

import { type ChangeEvent, type Ref, useState } from "react";
import { Input } from "../primitives/input.js";

/**
 * Money fields are always cents internally (FRONTEND_SPEC.md §0.9, matching
 * the backend's "money in cents" rule) — this control displays/edits
 * dollars and reports cents to the form.
 */
export interface CentsInputProps {
  value: number | undefined;
  onChange: (cents: number | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  ref?: Ref<HTMLInputElement> | undefined;
}

export function CentsInput({ value, onChange, placeholder, disabled, id, ref }: CentsInputProps) {
  const [text, setText] = useState(value === undefined ? "" : (value / 100).toFixed(2));

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setText(raw);
    if (raw.trim() === "") {
      onChange(undefined);
      return;
    }
    const dollars = Number.parseFloat(raw);
    if (Number.isFinite(dollars)) {
      onChange(Math.round(dollars * 100));
    }
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        $
      </span>
      <Input
        ref={ref}
        id={id}
        inputMode="decimal"
        className="pl-6"
        value={text}
        placeholder={placeholder ?? "0.00"}
        disabled={disabled}
        onChange={handleChange}
      />
    </div>
  );
}
