/**
 * Split out of `page.tsx` (OUTREACH-2) — a Next.js page file may only
 * export a fixed allow-list of names (`default`, `metadata`, etc.), so a
 * plain helper function can't live there even though it's only ever used
 * by that one page. Kept testable directly without driving a Radix
 * `Select`'s pointer/scroll interactions through jsdom (this repo's tests
 * don't exercise that anywhere else either).
 */
export type LeadsSort = "newest" | "score";

export function buildLeadsQueryString(sort: LeadsSort, minScore: string): string {
  const params = new URLSearchParams();
  if (sort === "score") params.set("sort", "score");
  if (minScore.trim() !== "") params.set("min_score", minScore.trim());
  return params.toString();
}
