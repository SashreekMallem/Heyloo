/**
 * The in-browser metrics collector `measure.ts` injects via
 * `page.addInitScript(collectWebVitals)` (Playwright serializes the
 * function source and runs it in the page before any of the page's own
 * scripts, on every navigation — so it must be fully self-contained,
 * no references to anything outside its own body/closures, since it
 * runs in the browser, not this Node process).
 *
 * LCP: the standard `PerformanceObserver` `largest-contentful-paint`
 * entry type — each new entry replaces the running value, and the LAST
 * one observed before paint settles is the real LCP (browsers keep
 * firing a new entry each time a larger element paints).
 *
 * CLS: the same windowed-session algorithm the `web-vitals` library
 * uses (not a naive running sum, which over-counts on a long page) —
 * consecutive shifts less than 1s apart and within a 5s window form one
 * "session window"; CLS is the largest session window's summed value,
 * and only shifts with no recent user input count at all.
 */
export function collectWebVitals() {
  const target = window as unknown as { __heylooPerf: { lcp: number; cls: number } };
  target.__heylooPerf = { lcp: 0, cls: 0 };

  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) target.__heylooPerf.lcp = last.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    // LCP unsupported in this browser — stays 0, which the budget check would then (correctly) treat as "no LCP recorded", never a false pass.
  }

  try {
    let sessionValue = 0;
    let sessionStart = 0;
    let sessionLastEntryTime = 0;

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<
        PerformanceEntry & { value: number; hadRecentInput: boolean }
      >) {
        if (entry.hadRecentInput) continue;

        if (
          sessionValue &&
          entry.startTime - sessionLastEntryTime < 1000 &&
          entry.startTime - sessionStart < 5000
        ) {
          sessionValue += entry.value;
        } else {
          sessionValue = entry.value;
          sessionStart = entry.startTime;
        }
        sessionLastEntryTime = entry.startTime;

        if (sessionValue > target.__heylooPerf.cls) {
          target.__heylooPerf.cls = sessionValue;
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    // layout-shift unsupported — stays 0.
  }
}
