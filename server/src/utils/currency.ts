export function toCents(amount: number) {
  return Math.round(amount * 100);
}

export function fromCents(cents: number) {
  return Math.round((cents / 100) * 100) / 100;
}

export function roundCurrency(amount: number) {
  return Math.round(amount * 100) / 100;
}
