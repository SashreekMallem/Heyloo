/**
 * `YYYY-MM-01` of the current month in the tenant's time zone (the browser's
 * zone when the tenant's is unknown or invalid). `usage_daily` rows are bucketed by
 * the tenant-local date and `job-billing-cycle` bills the tenant-local calendar
 * month, so the "usage this period" tile must start on the same day (BILL-12).
 */
export function localMonthStart(timeZone: string | null | undefined, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone ?? undefined,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(now);
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    if (year && month) return `${year}-${month}-01`;
  } catch {
    // unknown time zone: fall through to the browser's own month
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}
