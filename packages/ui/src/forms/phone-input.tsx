"use client";

import type { ChangeEvent, Ref } from "react";
import { formatPhoneDisplay } from "../lib/format-phone.js";
import { Input } from "../primitives/input.js";

/** E.164 mask (FRONTEND_SPEC.md §1.1) — normalizes US/CA input to `+1XXXXXXXXXX` as the user types; displays the raw digits, reports E.164 upward. */
export interface PhoneInputProps {
  value: string;
  onChange: (e164: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  ref?: Ref<HTMLInputElement> | undefined;
}

function toE164(input: string): string {
  const digits = input.replace(/[^\d]/g, "");
  if (digits.length === 0) return "";
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

export function PhoneInput({ value, onChange, placeholder, disabled, id, ref }: PhoneInputProps) {
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    onChange(toE164(e.target.value));
  }

  return (
    <Input
      ref={ref}
      id={id}
      type="tel"
      inputMode="tel"
      value={formatPhoneDisplay(value)}
      placeholder={placeholder ?? "(555) 123-4567"}
      disabled={disabled}
      onChange={handleChange}
    />
  );
}
