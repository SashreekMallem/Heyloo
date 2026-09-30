"use client";

import { InputOTP, InputOTPGroup, InputOTPSlot } from "@heyloo/ui/input-otp";

/** Same value as `input-otp`'s `REGEXP_ONLY_DIGITS` (that package is a dependency of @heyloo/ui, not of this app). */
const DIGITS_ONLY = "^\\d*$";

export interface OtpCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Focus the field on mount. */
  autoFocus?: boolean;
}

/**
 * The 6-digit TOTP field shared by `/mfa/challenge` and `/mfa/enroll`
 * (AUTH-11, MAP-10): digits only (letters are rejected as typed or pasted),
 * numeric mobile keyboard, one-time-code autofill, and an accessible name on
 * the real input so screen readers and axe see a labelled control.
 */
export function OtpCodeInput({ value, onChange, disabled, autoFocus }: OtpCodeInputProps) {
  return (
    <InputOTP
      maxLength={6}
      value={value}
      onChange={onChange}
      pattern={DIGITS_ONLY}
      inputMode="numeric"
      autoComplete="one-time-code"
      aria-label="6-digit verification code"
      disabled={disabled}
      autoFocus={autoFocus}
    >
      <InputOTPGroup>
        {Array.from({ length: 6 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed 6-slot OTP, slot position is the identity
          <InputOTPSlot key={i} index={i} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
