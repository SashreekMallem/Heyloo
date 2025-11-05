export function toCents(amount) {
    return Math.round(amount * 100);
}
export function fromCents(cents) {
    return Math.round((cents / 100) * 100) / 100;
}
export function roundCurrency(amount) {
    return Math.round(amount * 100) / 100;
}
