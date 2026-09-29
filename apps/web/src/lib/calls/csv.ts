/**
 * One CSV cell: quote-wrapped, with formula-injection neutralised (QA-1 F-17).
 * A cell that begins with `=`, `+`, `-`, `@`, TAB or CR is interpreted as a
 * formula by Excel / Sheets, and `caller_number` / `outcome` can carry
 * caller-influenced text — so such values get a leading apostrophe. A plain
 * E.164 number (`+15551234567`) cannot execute anything and is left intact so
 * exported phone numbers stay usable.
 */
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text) && !/^\+\d{6,15}$/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}
