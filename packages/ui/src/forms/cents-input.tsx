"use client";

import { type ChangeEvent, type Ref, useEffect, useId, useRef, useState } from "react";
import { cn } from "../lib/utils.js";
import { Input } from "../primitives/input.js";

/**
 * Money fields are always cents internally (FRONTEND_SPEC.md §0.9, matching
 * the backend's "money in cents" rule) — this control displays/edits
 * dollars and reports cents to the form.
 *
 * Typed text is parsed STRICTLY (QA-1 F-4): only `1234`, `1,234.50`, `$20`,
 * `.5`, `20.` shapes with at most 2 decimals are amounts. Anything else
 * (`12abc`, `1e3`, `45.555`, `-5`) is reported to the form as `NaN` — so a
 * zod `number()` field fails validation instead of silently keeping the
 * previous value — and flagged inline. The old lenient `parseFloat` turned
 * `1,234.50` into 100 cents and `1e3` into 100000. Arithmetic is on the
 * digit strings, never on floats, so `19.99` is exactly 1999.
 */
export interface CentsInputProps {
  value: number | undefined;
  onChange: (cents: number | undefined) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  ref?: Ref<HTMLInputElement> | undefined;
}

export type ParsedCurrency =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "ok"; cents: number };

// Optional whole part (plain digits, or comma-grouped thousands), optional
// fraction of at most 2 digits. At least one digit is checked separately.
const CURRENCY_SHAPE = /^(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d{0,2})?$/;
const MAX_WHOLE_DIGITS = 12;

/** Parses what a person typed in a dollar field into integer cents. */
export function parseCurrencyToCents(raw: string): ParsedCurrency {
  if (raw.trim() === "") return { kind: "empty" };
  const text = raw.trim().replace(/^\$\s*/, "");
  if (!/\d/.test(text) || !CURRENCY_SHAPE.test(text)) return { kind: "invalid" };
  const [whole = "", fraction = ""] = text.split(".");
  const digits = whole.replace(/,/g, "");
  if (digits.length > MAX_WHOLE_DIGITS) return { kind: "invalid" };
  const cents = Number(digits || "0") * 100 + Number(`${fraction}00`.slice(0, 2));
  return Number.isSafeInteger(cents) ? { kind: "ok", cents } : { kind: "invalid" };
}

function formatCents(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "" : (value / 100).toFixed(2);
}

export function CentsInput({
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  id,
  ref,
}: CentsInputProps) {
  const [text, setText] = useState(formatCents(value));
  const lastReported = useRef<number | undefined>(value);
  const focused = useRef(false);
  const errorId = useId();

  // A form reset / async load changes `value` from outside; adopt it unless
  // it is just the echo of what this control last reported. While the person
  // is typing here the text is the source of truth: a parent that maps an
  // emptied field to 0 (`cents ?? 0`) must not rewrite it to "0.00" mid-edit
  // (blur re-syncs instead).
  useEffect(() => {
    if (Object.is(value, lastReported.current)) return;
    lastReported.current = value;
    if (focused.current) return;
    setText(formatCents(value));
  }, [value]);

  const parsed = parseCurrencyToCents(text);
  const invalid = parsed.kind === "invalid";

  function report(next: number | undefined) {
    lastReported.current = next;
    onChange(next);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setText(raw);
    const result = parseCurrencyToCents(raw);
    if (result.kind === "empty") report(undefined);
    else if (result.kind === "ok") report(result.cents);
    else report(Number.NaN);
  }

  function handleFocus() {
    focused.current = true;
  }

  function handleBlur() {
    focused.current = false;
    if (parsed.kind === "ok") setText(formatCents(parsed.cents));
    // Emptied field whose parent holds a value anyway (e.g. `cents ?? 0`): show it.
    else if (parsed.kind === "empty" && value !== undefined) setText(formatCents(value));
    onBlur?.();
  }

  return (
    <div className="space-y-1">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          $
        </span>
        <Input
          ref={ref}
          id={id}
          inputMode="decimal"
          className={cn("pl-6", invalid && "border-destructive focus-visible:ring-destructive")}
          value={text}
          placeholder={placeholder ?? "0.00"}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
      </div>
      {invalid && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          Enter an amount like 1,234.50 (up to 2 decimal places).
        </p>
      )}
    </div>
  );
}

/**
 * Customer-facing alias (DESIGN-4): every real call site (vertical-details'
 * fee/deposit/delivery fields) wants "a currency input", not the storage
 * detail that it happens to hold cents underneath — same component, same
 * cents<->dollars conversion, just named for what the person filling out
 * the form is looking at rather than for the wire representation.
 */
export const CurrencyInput = CentsInput;
export type CurrencyInputProps = CentsInputProps;
